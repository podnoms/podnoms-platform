// Removes media files nothing needs any more: files no show, episode or
// user refers to (bar those of deleted shows, see deleted-shows.server.ts),
// uploads that never became an episode, the kept upload of an episode that
// has been failed for a week, live recordings that were never made into
// episodes, HLS streams' old versions, and whatever processing left behind
// (unfinished downloads, the upload of an episode that's ready, half-written
// files). Run daily as a job (see jobs.server.ts); safe to run at any time,
// and to run again.
import '@tanstack/react-start/server-only'
import { readdir, rm, rmdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { deletedShowMedia } from '~/server/deleted-shows.server'
import { episodes, liveBroadcasts, shows, users } from '~/server/db/schema'
import { localImageUrl } from '~/server/images.server'
import { logger } from '~/server/logger.server'
import { notifyEpisodeFailed } from '~/server/notifications.server'
import { episodeSourcePath, mediaDirs } from '~/server/storage.server'

const day = 24 * 60 * 60 * 1000
// Files are only removed once they're this old, so nothing being made right
// now (an episode's audio before its row is updated, say) is touched.
export const orphanGraceMs = day
// How long a failed upload's file is kept for retrying.
export const failedSourceMaxAgeMs = 7 * day
// How long a live recording is kept if making it into an episode failed.
export const liveRecordingMaxAgeMs = 7 * day

export const failedSourceRemovedError =
  'The uploaded file was removed after a week. Replace the audio to try again.'

type File = { name: string; path: string; modified: number }

// An episode's HLS folder holds a folder per version; all but the current
// one are left a while for players part way through them (see hls.server.ts).
// Folders of episodes that are gone go too.
async function removeOldHlsVersions(now: number, current: Map<string, string | null>, wanted: (id: string) => boolean) {
  let removed = 0
  for (const episodeDir of await readdir(mediaDirs.hls, { withFileTypes: true }).catch(() => [])) {
    if (!episodeDir.isDirectory()) continue
    const path = join(mediaDirs.hls, episodeDir.name)
    const keepAll = wanted(episodeDir.name) && !current.has(episodeDir.name)
    for (const versionDir of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      if (!versionDir.isDirectory() || keepAll) continue
      if (wanted(episodeDir.name) && versionDir.name === current.get(episodeDir.name)) continue
      const versionPath = join(path, versionDir.name)
      const modified = (await stat(versionPath).catch(() => null))?.mtimeMs ?? now
      if (now - modified < orphanGraceMs) continue
      await rm(versionPath, { recursive: true, force: true })
      removed++
    }
    if ((await readdir(path).catch(() => ['?'])).length === 0) await rmdir(path).catch(() => {})
  }
  return removed
}

async function filesIn(dir: string): Promise<File[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: File[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(dir, entry.name)
    const info = await stat(path).catch(() => null)
    if (info) files.push({ name: entry.name, path, modified: info.mtimeMs })
  }
  return files
}

// Removes the files in `dir` older than the grace period that aren't wanted,
// going by their names. Returns how many it removed.
async function removeUnwanted(dir: string, now: number, wanted: (name: string) => boolean) {
  let removed = 0
  for (const file of await filesIn(dir)) {
    if (now - file.modified < orphanGraceMs || wanted(file.name)) continue
    await rm(file.path, { force: true })
    removed++
  }
  return removed
}

// Names are "<id>.<extension>", sometimes with more after the ID
// ("<id>.replacement.mp3", "<id>.download.webm.part").
const beforeFirstDot = (name: string) => name.split('.')[0]!

// A stored image is "<id>.jpg"; anything else there ("<id>.jpg.original", a
// download being converted) is null, as is anything but a finished resized
// copy ("<id>-<width>.<extension>", "<id>-og.jpg") among the variants.
const storedImageId = (name: string) => /^([0-9a-f-]{36})\.jpg$/.exec(name)?.[1] ?? null
const imageVariantId = (name: string) => /^([0-9a-f-]{36})-\w+\.(?:jpg|webp)$/.exec(name)?.[1] ?? null

// Staged files, one folder per user, are kept for a day; empty folders go too.
async function removeStaleStaged(dir: string, now: number) {
  let removed = 0
  const userDirs = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const userDir of userDirs) {
    if (!userDir.isDirectory()) continue
    const path = join(dir, userDir.name)
    removed += await removeUnwanted(path, now, () => false)
    if ((await readdir(path).catch(() => ['?'])).length === 0) await rmdir(path).catch(() => {})
  }
  return removed
}

// Failed uploads keep their file so they can be retried; after a week the
// file goes, and the episode says to upload it again.
async function removeOldFailedSources(now: number) {
  const failed = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.status, 'failed'),
        isNull(episodes.sourceUrl),
        lt(episodes.updatedAt, new Date(now - failedSourceMaxAgeMs)),
      ),
    )
  let removed = 0
  for (const { id } of failed) {
    const path = episodeSourcePath(id)
    if (!(await stat(path).catch(() => null))) continue
    await rm(path, { force: true })
    await db.update(episodes).set({ error: failedSourceRemovedError }).where(eq(episodes.id, id))
    notifyEpisodeFailed(id, failedSourceRemovedError)
    removed++
  }
  return removed
}

// A broadcast's recording is removed once it's an episode; one that failed is
// kept a week, in case it's wanted. Never while the show is live, nor once
// it's deleted (its recordings are archived with it).
async function removeOldLiveRecordings(now: number, deletedShowIds: Set<string>) {
  const live = new Set(
    (await db.select({ showId: liveBroadcasts.showId }).from(liveBroadcasts).where(isNull(liveBroadcasts.endedAt))).map(
      (row) => row.showId,
    ),
  )
  for (const showId of deletedShowIds) live.add(showId)
  const root = join(mediaDirs.liveRecordings, 'live')
  let removed = 0
  for (const showDir of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!showDir.isDirectory() || live.has(showDir.name)) continue
    const path = join(root, showDir.name)
    for (const file of await filesIn(path)) {
      if (now - file.modified < liveRecordingMaxAgeMs) continue
      await rm(file.path, { force: true })
      removed++
    }
    if ((await readdir(path).catch(() => ['?'])).length === 0) await rmdir(path).catch(() => {})
  }
  return removed
}

export async function cleanUpMedia(now = Date.now()) {
  // Deleted shows' files are left for the show-archive job to move, should
  // it not have run yet (see deleted-shows.server.ts).
  const deleted = await deletedShowMedia()
  const episodeRows = await db
    .select({ id: episodes.id, hlsVersion: episodes.hlsVersion, status: episodes.status, replacement: episodes.replacement })
    .from(episodes)
  const episodeIds = new Set(episodeRows.map((row) => row.id))
  const hlsVersions = new Map(episodeRows.map((row) => [row.id, row.hlsVersion]))

  // A database with no episodes while there are audio files is more likely
  // the wrong database (or an empty one being restored) than a site whose
  // episodes have all been deleted. Leave the episode files alone then.
  const audioFiles = await filesIn(mediaDirs.audio)
  const keepEpisodeFiles = episodeIds.size === 0 && audioFiles.length > 0
  if (keepEpisodeFiles) logger.warn('No episodes in the database; leaving episode files alone')
  const episodeWanted = (id: string) => keepEpisodeFiles || episodeIds.has(id) || deleted.episodeIds.has(id)

  // What processing leaves behind when it's interrupted (it clears up after
  // itself otherwise, see episode-processor.server.ts). Episodes of deleted
  // shows aren't in the table, so keep everything.
  const processing = new Set(episodeRows.filter((row) => row.status === 'processing').map((row) => row.id))
  const replacing = new Set(episodeRows.filter((row) => row.replacement).map((row) => row.id))
  const done = new Set(episodeRows.filter((row) => row.status === 'ready' && !row.replacement).map((row) => row.id))
  // Audio and masters: "<id>.mp3"/"<id>.mka", plus the files of audio being
  // made to replace it and of downloads under way.
  const audioWanted = (name: string) => {
    const id = beforeFirstDot(name)
    // A download is only that while it's downloading.
    if (name.includes('.download.')) return processing.has(id) || replacing.has(id)
    if (!episodeWanted(id)) return false
    return !name.includes('.replacement.') || !episodeIds.has(id) || replacing.has(id)
  }
  // An upload is kept until its episode is ready (so a failed conversion can
  // be retried), and no longer.
  const sourceWanted = (name: string) => episodeWanted(name) && !done.has(name)

  const imageRows = await Promise.all([
    db.select({ url: shows.imageUrl }).from(shows).where(isNotNull(shows.imageUrl)),
    db.select({ url: episodes.imageUrl }).from(episodes).where(isNotNull(episodes.imageUrl)),
    db.select({ url: users.image }).from(users).where(isNotNull(users.image)),
  ])
  const imageIds = new Set([
    ...imageRows.flat().flatMap(({ url }) => localImageUrl.exec(url ?? '')?.[1] ?? []),
    ...deleted.imageIds,
  ])

  const removed = {
    failedSources: await removeOldFailedSources(now),
    audio: await removeUnwanted(mediaDirs.audio, now, audioWanted),
    masters: await removeUnwanted(mediaDirs.masters, now, audioWanted),
    // Episodes of deleted shows (wanted, but not in the table) keep everything.
    hlsVersions: await removeOldHlsVersions(now, hlsVersions, episodeWanted),
    waveforms: await removeUnwanted(mediaDirs.waveforms, now, (name) => episodeWanted(beforeFirstDot(name))),
    sources: await removeUnwanted(mediaDirs.sources, now, sourceWanted),
    images: await removeUnwanted(mediaDirs.images, now, (name) => imageIds.has(storedImageId(name) ?? '')),
    // Resized copies of images that are gone.
    imageVariants: await removeUnwanted(mediaDirs.imageVariants, now, (name) => imageIds.has(imageVariantId(name) ?? '')),
    stagedUploads: await removeStaleStaged(mediaDirs.uploads, now),
    stagedImages: await removeStaleStaged(mediaDirs.stagedImages, now),
    liveRecordings: await removeOldLiveRecordings(now, deleted.showIds),
  }
  return removed
}
