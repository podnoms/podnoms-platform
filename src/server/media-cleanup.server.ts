// Removes media files nothing needs any more: files no podcast, episode or
// user refers to, uploads that never became an episode, and the kept upload of
// an episode that has been failed for a week. Run daily as a job (see
// jobs.server.ts); safe to run at any time, and to run again.
import '@tanstack/react-start/server-only'
import { readdir, rm, rmdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, podcasts, users } from '~/server/db/schema'
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

export const failedSourceRemovedError =
  'The uploaded file was removed after a week. Replace the audio to try again.'

type File = { name: string; path: string; modified: number }

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

// Removes the files in `dir` older than the grace period whose ID (taken from
// the name) isn't wanted. Returns how many it removed.
async function removeUnwanted(dir: string, now: number, idOf: (name: string) => string, wanted: (id: string) => boolean) {
  let removed = 0
  for (const file of await filesIn(dir)) {
    if (now - file.modified < orphanGraceMs || wanted(idOf(file.name))) continue
    await rm(file.path, { force: true })
    removed++
  }
  return removed
}

// Names are "<id>.<extension>", sometimes with more after the ID
// ("<id>.replacement.mp3", "<id>.jpg.original").
const beforeFirstDot = (name: string) => name.split('.')[0]!

// Staged files, one folder per user, are kept for a day; empty folders go too.
async function removeStaleStaged(dir: string, now: number) {
  let removed = 0
  const userDirs = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const userDir of userDirs) {
    if (!userDir.isDirectory()) continue
    const path = join(dir, userDir.name)
    removed += await removeUnwanted(path, now, (name) => name, () => false)
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

export async function cleanUpMedia(now = Date.now()) {
  const episodeIds = new Set((await db.select({ id: episodes.id }).from(episodes)).map((row) => row.id))

  // A database with no episodes while there are audio files is more likely
  // the wrong database (or an empty one being restored) than a site whose
  // episodes have all been deleted. Leave the episode files alone then.
  const audioFiles = await filesIn(mediaDirs.audio)
  const keepEpisodeFiles = episodeIds.size === 0 && audioFiles.length > 0
  if (keepEpisodeFiles) logger.warn('No episodes in the database; leaving episode files alone')
  const episodeWanted = (id: string) => keepEpisodeFiles || episodeIds.has(id)

  const imageRows = await Promise.all([
    db.select({ url: podcasts.imageUrl }).from(podcasts).where(isNotNull(podcasts.imageUrl)),
    db.select({ url: episodes.imageUrl }).from(episodes).where(isNotNull(episodes.imageUrl)),
    db.select({ url: users.image }).from(users).where(isNotNull(users.image)),
  ])
  const imageIds = new Set(imageRows.flat().flatMap(({ url }) => localImageUrl.exec(url ?? '')?.[1] ?? []))

  const removed = {
    failedSources: await removeOldFailedSources(now),
    audio: await removeUnwanted(mediaDirs.audio, now, beforeFirstDot, episodeWanted),
    waveforms: await removeUnwanted(mediaDirs.waveforms, now, beforeFirstDot, episodeWanted),
    sources: await removeUnwanted(mediaDirs.sources, now, beforeFirstDot, episodeWanted),
    images: await removeUnwanted(mediaDirs.images, now, beforeFirstDot, (id) => imageIds.has(id)),
    // "<image id>-<width>.<extension>": resized copies of images that are gone.
    imageVariants: await removeUnwanted(mediaDirs.imageVariants, now, (name) => name.slice(0, 36), (id) => imageIds.has(id)),
    stagedUploads: await removeStaleStaged(mediaDirs.uploads, now),
    stagedImages: await removeStaleStaged(mediaDirs.stagedImages, now),
  }
  return removed
}
