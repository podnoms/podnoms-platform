// Turns an episode's source into audio, then marks it ready (or failed). A
// source link is downloaded by yt-dlp, which extracts an MP3 and reports the
// metadata; an uploaded file is converted to MP3 by ffmpeg. A ready episode's
// audio can be replaced the same way, without taking it offline meanwhile.
//
// Jobs run in this server process, so only one instance of the app may run.
// Downloads wait for a slot in the site-wide download throttle (see
// download-throttle.server.ts), which keeps us polite to the platforms;
// uploads touch no platform, so they're converted one at a time on their own.
import '@tanstack/react-start/server-only'
import { rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { eq, inArray, isNotNull, or } from 'drizzle-orm'
import { plainTextToHtml } from '~/lib/rich-text'
import { db } from '~/server/db/client.server'
import { platformOf } from '~/lib/platforms'
import { channelItems, episodes, type Episode, type EpisodeReplacement } from '~/server/db/schema'
import { onThrottleChange, placeInQueue, RateLimitedError, withDownloadSlot } from '~/server/download-throttle.server'
import { publishEpisodeEvent } from '~/server/episode-events.server'
import { availableEpisodeSlug, isSlugConflict, withRandomSuffix } from '~/server/episode-slugs.server'
import { downloadImage } from '~/server/images.server'
import { convertToMp3, probeAudio } from '~/server/media.server'
import { logger, reportError } from '~/server/logger.server'
import { notifyEpisodeFailed } from '~/server/notifications.server'
import { saveWaveform } from '~/server/waveforms.server'
import { runYtDlpLines } from '~/server/ytdlp.server'
import {
  ensureAudioDir,
  episodeAudioPath,
  episodeAudioUrl,
  episodeSourcePath,
  replacementAudioName,
  replacementAudioPath,
} from '~/server/storage.server'

// Live progress of queued and running jobs, kept in memory: it changes many
// times a second and is only interesting while a job is running.
export type EpisodeProgress =
  | { stage: 'queued'; ahead: number }
  | { stage: 'fetching' }
  | {
    stage: 'downloading'
    downloadedBytes: number
    totalBytes: number | null
    bytesPerSecond: number | null
    secondsLeft: number | null
  }
  // Percent is known when converting an upload, but not a download.
  | { stage: 'converting'; percent: number | null }

const progress = new Map<string, Exclude<EpisodeProgress, { stage: 'queued' }>>()

// Every change of progress goes out to open pages (see episode-events.server.ts).
function setProgress(episodeId: string, value: Exclude<EpisodeProgress, { stage: 'queued' }>) {
  progress.set(episodeId, value)
  publishEpisodeEvent({ type: 'progress', episodeId, progress: value })
}

// The job is over, so its stored details have changed too.
function endProgress(episodeId: string) {
  progress.delete(episodeId)
  publishEpisodeEvent({ type: 'progress', episodeId, progress: null })
  publishEpisodeEvent({ type: 'changed', episodeId })
}

type SourceInfo = {
  title?: string
  description?: string
  duration?: number
  thumbnail?: string
  filepath?: string
  // When it was uploaded: as a Unix time, or failing that a date (YYYYMMDD).
  timestamp?: number
  upload_date?: string
}

type DownloadProgress = {
  status?: string
  downloaded_bytes?: number
  total_bytes?: number | null
  total_bytes_estimate?: number | null
  speed?: number | null
  eta?: number | null
}

// What's known about the source before its audio is downloaded.
type SourceDetails = Pick<SourceInfo, 'title' | 'description' | 'duration' | 'thumbnail'>

// The source's details, printed by yt-dlp once the download is saved. They're
// also printed (as DETAILS) once it's looked the source up, before the
// download starts.
async function runYtDlp(sourceUrl: string, outputTemplate: string, onLine: (line: string) => void) {
  const args = [
    '--no-playlist',
    // --print implies --quiet, which would hide progress; --newline gives one
    // progress line per update instead of redrawing a single line.
    '--progress',
    '--newline',
    '--progress-template',
    'download:PROGRESS %(progress.{status,downloaded_bytes,total_bytes,total_bytes_estimate,speed,eta})j',
    // --print would otherwise skip the download.
    '--no-simulate',
    // Just the audio, as the site has it; it's converted afterwards.
    '--format',
    'bestaudio/best',
    '--output',
    outputTemplate,
    '--print',
    'video:DETAILS %(.{title,description,duration,thumbnail})j',
    '--print',
    'after_move:INFO %(.{title,description,duration,thumbnail,filepath,timestamp,upload_date})j',
    sourceUrl,
  ]
  let info: SourceInfo | undefined
  await runYtDlpLines(args, (line) => {
    if (line.startsWith('INFO ')) info = JSON.parse(line.slice(5)) as SourceInfo
    else onLine(line)
  })
  if (!info) throw new Error('yt-dlp returned no information about the download')
  return info
}

// What a download or conversion learnt about the episode's audio.
type ProcessedAudio = Pick<SourceInfo, 'title' | 'description' | 'thumbnail' | 'timestamp' | 'upload_date'> & {
  path: string
  durationSeconds: number | null
}

// Saved in the audio folder as `<name>.mp3`. yt-dlp downloads the audio as
// the site has it (`<name>.download.<ext>`), and it's converted here rather
// than by yt-dlp, which doesn't report how its conversion is going.
// `onDetails` gets the source's details as soon as they're known, before the
// download; it's waited for before this returns.
async function downloadSource(
  episodeId: string,
  sourceUrl: string,
  { name = episodeId, onDetails }: { name?: string; onDetails?: (details: SourceDetails) => Promise<void> } = {},
): Promise<ProcessedAudio> {
  setProgress(episodeId, { stage: 'fetching' })
  let detailsSaved: Promise<void> | undefined
  const onLine = (line: string) => {
    if (line.startsWith('DETAILS ')) {
      detailsSaved ??= onDetails?.(JSON.parse(line.slice(8)) as SourceDetails)
      return
    }
    if (!line.startsWith('PROGRESS ')) return
    const p = JSON.parse(line.slice(9)) as DownloadProgress
    setProgress(episodeId, {
      stage: 'downloading',
      downloadedBytes: p.downloaded_bytes ?? 0,
      totalBytes: p.total_bytes ?? p.total_bytes_estimate ?? null,
      bytesPerSecond: p.speed ?? null,
      secondsLeft: p.eta ?? null,
    })
  }
  const dir = await ensureAudioDir()
  let info: SourceInfo
  try {
    info = await runYtDlp(sourceUrl, join(dir, `${name}.download.%(ext)s`), onLine)
  } finally {
    await detailsSaved
  }
  if (!info.filepath) throw new Error("yt-dlp didn't say where it saved the download")
  const downloaded = info.filepath
  const path = join(dir, `${name}.mp3`)
  try {
    const audio = await probeAudio(downloaded)
    if (!audio) throw new Error("The download doesn't contain any audio")
    // The site's length, where it gives one, else the file's.
    const durationSeconds = info.duration ? Math.round(info.duration) : audio.durationSeconds
    setProgress(episodeId, { stage: 'converting', percent: 0 })
    await convertToMp3(downloaded, path, { ...audio, durationSeconds }, (fraction) => {
      setProgress(episodeId, { stage: 'converting', percent: Math.floor(fraction * 100) })
    })
    return { ...info, path, durationSeconds }
  } catch (error) {
    await rm(path, { force: true })
    throw error
  } finally {
    await rm(downloaded, { force: true })
  }
}

async function convertUpload(episodeId: string, path = episodeAudioPath(episodeId)): Promise<ProcessedAudio> {
  setProgress(episodeId, { stage: 'converting', percent: 0 })
  const source = episodeSourcePath(episodeId)
  const info = await probeAudio(source)
  if (!info) throw new Error("The uploaded file is missing or doesn't contain any audio")
  await ensureAudioDir()
  try {
    await convertToMp3(source, path, info, (fraction) => {
      setProgress(episodeId, { stage: 'converting', percent: Math.floor(fraction * 100) })
    })
  } catch (error) {
    await rm(path, { force: true })
    throw error
  }
  return { path, durationSeconds: info.durationSeconds }
}

async function processEpisode(episodeId: string) {
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1)
  if (!episode) return
  if (episode.replacement) return replaceAudio(episode, episode.replacement)
  await db.update(episodes).set({ status: 'processing', error: null }).where(eq(episodes.id, episodeId))
  publishEpisodeEvent({ type: 'changed', episodeId })

  const job = { episodeId, podcastId: episode.podcastId, sourceUrl: episode.sourceUrl }
  const started = Date.now()
  logger.info(job, 'Episode processing started')
  try {
    const audio = episode.sourceUrl
      ? await downloadSource(episodeId, episode.sourceUrl, { onDetails: (details) => saveSourceDetails(episodeId, details) })
      : await convertUpload(episodeId)
    await markReady(episodeId, audio)
    // The upload is only kept so a failed conversion can be retried.
    if (!episode.sourceUrl) await rm(episodeSourcePath(episodeId), { force: true })
    // The episode can be played meanwhile; it just has no waveform if this fails.
    await saveWaveform(episodeId).catch((error: unknown) => logWaveformFailure(episodeId, error))
    logger.info({ ...job, durationMs: Date.now() - started }, 'Episode processing finished')
  } catch (error) {
    if (error instanceof RateLimitedError) {
      // Not this episode's fault: it's tried again once the platform lets us.
      logger.warn({ ...job, err: error }, 'Episode download was refused by the platform; will retry')
      await db.update(episodes).set({ status: 'pending' }).where(eq(episodes.id, episodeId))
      throw error
    }
    reportError(error, { ...job, stage: progress.get(episodeId)?.stage, durationMs: Date.now() - started, msg: 'Episode processing failed' })
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(episodes)
      .set({ status: 'failed', error: message.slice(0, 1000) })
      .where(eq(episodes.id, episodeId))
    notifyEpisodeFailed(episodeId, message.slice(0, 300))
  } finally {
    endProgress(episodeId)
  }
}

// The source's details the episode doesn't have yet, i.e. what the user left
// out when adding it.
async function detailsFromSource(episode: Episode, source: SourceDetails) {
  const description = episode.description ?? (source.description ? plainTextToHtml(source.description) : null)
  // Store the source's artwork rather than linking to it, which can break.
  const imageUrl = episode.imageUrl ?? (source.thumbnail ? await downloadImage(source.thumbnail) : null)
  // Titles default to the link, and slugs are temporary, until the source's
  // real title is known.
  const titled = episode.title === episode.sourceUrl && source.title ? source.title : null
  const slug = titled ? await availableEpisodeSlug(episode.podcastId, titled, episode.id) : episode.slug
  return { title: titled ?? episode.title, slug, description, imageUrl }
}

// Numbers the slug if another episode has taken it meanwhile.
async function updateWithSlug(episodeId: string, values: Partial<Episode> & { slug: string }) {
  const update = (slug: string) => db.update(episodes).set({ ...values, slug }).where(eq(episodes.id, episodeId))
  try {
    await update(values.slug)
  } catch (error) {
    if (!isSlugConflict(error)) throw error
    await update(withRandomSuffix(values.slug))
  }
}

// Shows the source's details while its audio downloads, rather than the link.
// They're saved again once it's ready, so this failing doesn't matter.
async function saveSourceDetails(episodeId: string, source: SourceDetails) {
  try {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1)
    if (!episode) return
    const durationSeconds = source.duration ? Math.round(source.duration) : episode.durationSeconds
    await updateWithSlug(episodeId, { ...(await detailsFromSource(episode, source)), durationSeconds })
    publishEpisodeEvent({ type: 'changed', episodeId })
  } catch (error) {
    logger.warn({ episodeId, err: error }, "Could not save the source's details before downloading")
  }
}

async function markReady(episodeId: string, audio: ProcessedAudio) {
  // As it is now, with any details saved before the download.
  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1)
  if (!episode) return
  const { size } = await stat(audio.path)
  // A channel's uploads are dated as the channel has them, so the feed is in
  // the same order; anything else is new as of now.
  const publishedAt = episode.publishedAt ?? ((await isFromChannel(episode.id)) ? uploadedAt(audio) : null) ?? new Date()
  await updateWithSlug(episode.id, {
    ...(await detailsFromSource(episode, audio)),
    status: 'ready',
    durationSeconds: audio.durationSeconds ?? episode.durationSeconds,
    audioUrl: episodeAudioUrl(episode.id),
    audioMimeType: 'audio/mpeg',
    audioSizeBytes: size,
    publishedAt,
  })
}

async function isFromChannel(episodeId: string) {
  const [item] = await db.select({ episodeId: channelItems.episodeId }).from(channelItems).where(eq(channelItems.episodeId, episodeId)).limit(1)
  return Boolean(item)
}

function uploadedAt({ timestamp, upload_date }: Pick<SourceInfo, 'timestamp' | 'upload_date'>) {
  if (timestamp) return new Date(timestamp * 1000)
  const date = upload_date?.match(/^(\d{4})(\d{2})(\d{2})$/)
  return date ? new Date(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`) : null
}

// Makes the episode's new audio alongside its current audio, which stays live
// until the new audio takes its place. If that fails, the episode keeps its
// current audio and the error is noted. Its details are kept either way.
async function replaceAudio(episode: Episode, { sourceUrl }: EpisodeReplacement) {
  const id = episode.id
  try {
    const audio = sourceUrl
      ? await downloadSource(id, sourceUrl, { name: replacementAudioName(id) })
      : await convertUpload(id, replacementAudioPath(id))
    const { size } = await stat(audio.path)
    await rename(audio.path, episodeAudioPath(id))
    await db
      .update(episodes)
      .set({
        replacement: null,
        error: null,
        sourceUrl,
        durationSeconds: audio.durationSeconds,
        audioUrl: episodeAudioUrl(id, Date.now().toString(36)),
        audioMimeType: 'audio/mpeg',
        audioSizeBytes: size,
      })
      .where(eq(episodes.id, id))
    await saveWaveform(id).catch((error: unknown) => logWaveformFailure(id, error))
    logger.info({ episodeId: id, sourceUrl }, 'Episode audio replaced')
  } catch (error) {
    // Kept waiting to be replaced, and tried again once the platform lets us.
    if (error instanceof RateLimitedError) {
      logger.warn({ episodeId: id, sourceUrl, err: error }, 'Audio replacement was refused by the platform; will retry')
      throw error
    }
    reportError(error, { episodeId: id, podcastId: episode.podcastId, sourceUrl, stage: progress.get(id)?.stage, msg: 'Episode audio replacement failed' })
    const message = error instanceof Error ? error.message : String(error)
    await rm(replacementAudioPath(id), { force: true })
    await db
      .update(episodes)
      .set({ replacement: null, error: `Couldn't replace the audio: ${message}`.slice(0, 1000) })
      .where(eq(episodes.id, id))
  } finally {
    // Unlike a new episode's, a replacement upload isn't kept for retrying.
    if (!sourceUrl) await rm(episodeSourcePath(id), { force: true })
    endProgress(id)
  }
}

function logWaveformFailure(episodeId: string, error: unknown) {
  logger.warn({ episodeId, err: error }, 'Could not make a waveform for the episode')
}

// Every episode given to the processor and not yet done with, in the order
// given, and which lane it's in: downloads wait in the download throttle,
// uploads in the local queue. 'new' until its row has been read.
const jobs = new Map<string, 'new' | 'download' | 'local'>()
const localQueue: string[] = []
let localRunning: string | null = null
let localTail: Promise<unknown> = Promise.resolve()

export function enqueueEpisode(episodeId: string) {
  if (jobs.has(episodeId)) return
  jobs.set(episodeId, 'new')
  publishQueuePositions()
  void run(episodeId)
}

async function run(episodeId: string) {
  let retry = false
  try {
    const [episode] = await db
      .select({ podcastId: episodes.podcastId, title: episodes.title, sourceUrl: episodes.sourceUrl, replacement: episodes.replacement, priority: episodes.priority })
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .limit(1)
    if (!episode) return
    const sourceUrl = episode.replacement ? episode.replacement.sourceUrl : episode.sourceUrl
    if (sourceUrl) {
      jobs.set(episodeId, 'download')
      const slot = { priority: episode.priority, key: episode.podcastId, id: episodeId, label: episode.title }
      await withDownloadSlot(platformOf(sourceUrl), slot, () => processEpisode(episodeId))
    } else {
      jobs.set(episodeId, 'local')
      await runLocally(episodeId)
    }
  } catch (error) {
    // The platform refused us; the throttle holds it back until it's likely
    // to let us again.
    if (error instanceof RateLimitedError) retry = true
    else reportError(error, { episodeId, msg: 'Episode processing failed' })
  } finally {
    jobs.delete(episodeId)
    publishQueuePositions()
  }
  if (retry) enqueueEpisode(episodeId)
}

// Uploads are converted one at a time, in the order they came.
function runLocally(episodeId: string) {
  localQueue.push(episodeId)
  const turn = localTail.then(async () => {
    localQueue.splice(localQueue.indexOf(episodeId), 1)
    localRunning = episodeId
    publishQueuePositions()
    try {
      await processEpisode(episodeId)
    } finally {
      localRunning = null
    }
  })
  localTail = turn.catch(() => {})
  return turn
}

// Each queued episode's place changes whenever the queue moves.
function publishQueuePositions() {
  for (const id of jobs.keys()) {
    if (!progress.has(id)) publishEpisodeEvent({ type: 'progress', episodeId: id, progress: getEpisodeProgress(id) })
  }
}
onThrottleChange(publishQueuePositions)

export function getEpisodeProgress(episodeId: string): EpisodeProgress | null {
  const running = progress.get(episodeId)
  if (running) return running
  const lane = jobs.get(episodeId)
  if (lane === 'download') {
    const ahead = placeInQueue(episodeId)
    return ahead === null ? null : { stage: 'queued', ahead }
  }
  if (lane === 'local') {
    const index = localQueue.indexOf(episodeId)
    return index === -1 ? null : { stage: 'queued', ahead: index + (localRunning ? 1 : 0) }
  }
  // Not yet sorted into a lane: what's running, and what came just before it.
  if (lane === 'new') {
    const before = [...jobs].slice(0, [...jobs.keys()].indexOf(episodeId))
    return { stage: 'queued', ahead: progress.size + before.filter(([, l]) => l === 'new').length }
  }
  return null
}

// Episodes left pending or mid-download, or with audio waiting to be
// replaced, when the server last stopped. Picked
// up the first time the app handles a podcast request after starting.
let resumed = false
export async function resumeUnfinishedEpisodes() {
  if (resumed) return
  resumed = true
  const unfinished = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(or(inArray(episodes.status, ['pending', 'processing']), isNotNull(episodes.replacement)))
  for (const { id } of unfinished) enqueueEpisode(id)
}
