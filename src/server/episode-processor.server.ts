// Turns an episode's source into audio, then marks it ready (or failed). A
// source link is downloaded by yt-dlp, which extracts an MP3 and reports the
// metadata; an uploaded file is converted to MP3 by ffmpeg. A ready episode's
// audio can be replaced the same way, without taking it offline meanwhile.
//
// Jobs run in this server process, one at a time. That's fine for a single
// server; move to a real job queue before running several.
import '@tanstack/react-start/server-only'
import { spawn } from 'node:child_process'
import { rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { eq, inArray, isNotNull, or } from 'drizzle-orm'
import { env } from '~/env'
import { plainTextToHtml } from '~/lib/rich-text'
import { db } from '~/server/db/client.server'
import { episodes, type Episode, type EpisodeReplacement } from '~/server/db/schema'
import { availableEpisodeSlug, isSlugConflict, withRandomSuffix } from '~/server/episode-slugs.server'
import { downloadImage } from '~/server/images.server'
import { convertToMp3, probeAudio } from '~/server/media.server'
import { logger, reportError } from '~/server/logger.server'
import { saveWaveform } from '~/server/waveforms.server'
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

type SourceInfo = {
  title?: string
  description?: string
  duration?: number
  thumbnail?: string
  filepath?: string
}

type DownloadProgress = {
  status?: string
  downloaded_bytes?: number
  total_bytes?: number | null
  total_bytes_estimate?: number | null
  speed?: number | null
  eta?: number | null
}

type PostprocessProgress = { status?: string; postprocessor?: string }

function runYtDlp(sourceUrl: string, outputTemplate: string, onLine: (line: string) => void) {
  const args = [
    '--no-playlist',
    // --print implies --quiet, which would hide progress; --newline gives one
    // progress line per update instead of redrawing a single line.
    '--progress',
    '--newline',
    '--progress-template',
    'download:PROGRESS %(progress.{status,downloaded_bytes,total_bytes,total_bytes_estimate,speed,eta})j',
    '--progress-template',
    'postprocess:POSTPROCESS %(progress.{status,postprocessor})j',
    // --print would otherwise skip the download.
    '--no-simulate',
    '--extract-audio',
    '--audio-format',
    'mp3',
    '--output',
    outputTemplate,
    '--print',
    'after_move:INFO %(.{title,description,duration,thumbnail,filepath})j',
    sourceUrl,
  ]
  return new Promise<SourceInfo>((resolve, reject) => {
    const child = spawn(env.YTDLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let info: SourceInfo | undefined
    const errors: string[] = []
    // Progress and messages arrive on both streams, a line at a time.
    const readLines = (stream: NodeJS.ReadableStream) => {
      let buffered = ''
      stream.on('data', (chunk) => {
        buffered += chunk
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('INFO ')) info = JSON.parse(line.slice(5)) as SourceInfo
          // "ERROR: [youtube] abc123: This video is unavailable" → "This video is unavailable"
          else if (line.startsWith('ERROR')) errors.push(line.replace(/^ERROR:\s*(\[[^\]]+\]\s*[^:\s]+:\s*)?/, ''))
          else onLine(line)
        }
      })
    }
    readLines(child.stdout)
    readLines(child.stderr)
    child.on('error', (error) => reject(new Error(`Could not run yt-dlp: ${error.message}`)))
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(errors.at(-1) || `yt-dlp exited with code ${code}`))
      else if (!info) reject(new Error('yt-dlp returned no information about the download'))
      else resolve(info)
    })
  })
}

// What a download or conversion learnt about the episode's audio.
type ProcessedAudio = Pick<SourceInfo, 'title' | 'description' | 'thumbnail'> & {
  path: string
  durationSeconds: number | null
}

// Saved in the audio folder as `<name>.mp3`.
async function downloadSource(episodeId: string, sourceUrl: string, name = episodeId): Promise<ProcessedAudio> {
  progress.set(episodeId, { stage: 'fetching' })
  const onLine = (line: string) => {
    if (line.startsWith('PROGRESS ')) {
      const p = JSON.parse(line.slice(9)) as DownloadProgress
      progress.set(episodeId, {
        stage: 'downloading',
        downloadedBytes: p.downloaded_bytes ?? 0,
        totalBytes: p.total_bytes ?? p.total_bytes_estimate ?? null,
        bytesPerSecond: p.speed ?? null,
        secondsLeft: p.eta ?? null,
      })
    } else if (line.startsWith('POSTPROCESS ')) {
      const p = JSON.parse(line.slice(12)) as PostprocessProgress
      if (p.postprocessor === 'ExtractAudio' && p.status === 'started') {
        progress.set(episodeId, { stage: 'converting', percent: null })
      }
    }
  }
  const dir = await ensureAudioDir()
  const info = await runYtDlp(sourceUrl, join(dir, `${name}.%(ext)s`), onLine)
  return {
    ...info,
    path: info.filepath ?? join(dir, `${name}.mp3`),
    durationSeconds: info.duration ? Math.round(info.duration) : null,
  }
}

async function convertUpload(episodeId: string, path = episodeAudioPath(episodeId)): Promise<ProcessedAudio> {
  progress.set(episodeId, { stage: 'converting', percent: 0 })
  const source = episodeSourcePath(episodeId)
  const info = await probeAudio(source)
  if (!info) throw new Error("The uploaded file is missing or doesn't contain any audio")
  await ensureAudioDir()
  try {
    await convertToMp3(source, path, info, (fraction) => {
      progress.set(episodeId, { stage: 'converting', percent: Math.floor(fraction * 100) })
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

  const job = { episodeId, podcastId: episode.podcastId, sourceUrl: episode.sourceUrl }
  const started = Date.now()
  logger.info(job, 'Episode processing started')
  try {
    const audio = episode.sourceUrl ? await downloadSource(episodeId, episode.sourceUrl) : await convertUpload(episodeId)
    await markReady(episode, audio)
    // The upload is only kept so a failed conversion can be retried.
    if (!episode.sourceUrl) await rm(episodeSourcePath(episodeId), { force: true })
    // The episode can be played meanwhile; it just has no waveform if this fails.
    await saveWaveform(episodeId).catch((error: unknown) => logWaveformFailure(episodeId, error))
    logger.info({ ...job, durationMs: Date.now() - started }, 'Episode processing finished')
  } catch (error) {
    reportError(error, { ...job, stage: progress.get(episodeId)?.stage, durationMs: Date.now() - started, msg: 'Episode processing failed' })
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(episodes)
      .set({ status: 'failed', error: message.slice(0, 1000) })
      .where(eq(episodes.id, episodeId))
  } finally {
    progress.delete(episodeId)
  }
}

async function markReady(episode: Episode, audio: ProcessedAudio) {
  const { size } = await stat(audio.path)
  const description = episode.description ?? (audio.description ? plainTextToHtml(audio.description) : null)
  // Store the source's artwork rather than linking to it, which can break.
  const imageUrl = episode.imageUrl ?? (audio.thumbnail ? await downloadImage(audio.thumbnail) : null)
  // Titles default to the link, and slugs are temporary, until the source's
  // real title is known.
  const titled = episode.title === episode.sourceUrl && audio.title ? audio.title : null
  const slug = titled ? await availableEpisodeSlug(episode.podcastId, titled, episode.id) : episode.slug
  const update = (slug: string) =>
    db
      .update(episodes)
      .set({
        status: 'ready',
        title: titled ?? episode.title,
        slug,
        description,
        imageUrl,
        durationSeconds: audio.durationSeconds ?? episode.durationSeconds,
        audioUrl: episodeAudioUrl(episode.id),
        audioMimeType: 'audio/mpeg',
        audioSizeBytes: size,
        publishedAt: episode.publishedAt ?? new Date(),
      })
      .where(eq(episodes.id, episode.id))
  try {
    await update(slug)
  } catch (error) {
    if (!isSlugConflict(error)) throw error
    await update(withRandomSuffix(slug))
  }
}

// Makes the episode's new audio alongside its current audio, which stays live
// until the new audio takes its place. If that fails, the episode keeps its
// current audio and the error is noted. Its details are kept either way.
async function replaceAudio(episode: Episode, { sourceUrl }: EpisodeReplacement) {
  const id = episode.id
  try {
    const audio = sourceUrl
      ? await downloadSource(id, sourceUrl, replacementAudioName(id))
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
    progress.delete(id)
  }
}

function logWaveformFailure(episodeId: string, error: unknown) {
  logger.warn({ episodeId, err: error }, 'Could not make a waveform for the episode')
}

const queue: string[] = []
const queued = new Set<string>()
let draining = false

async function drain() {
  if (draining) return
  draining = true
  try {
    for (let id = queue.shift(); id; id = queue.shift()) {
      await processEpisode(id)
      queued.delete(id)
    }
  } finally {
    draining = false
  }
}

export function enqueueEpisode(episodeId: string) {
  if (queued.has(episodeId)) return
  queued.add(episodeId)
  queue.push(episodeId)
  void drain()
}

export function getEpisodeProgress(episodeId: string): EpisodeProgress | null {
  const running = progress.get(episodeId)
  if (running) return running
  const index = queue.indexOf(episodeId)
  // Jobs ahead: the rest of the queue before this one, plus the running job.
  return index === -1 ? null : { stage: 'queued', ahead: index + (draining ? 1 : 0) }
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
