// A deleted show's files aren't removed straight away. Deleting it writes a
// manifest to MEDIA_DIR/deleted/<show id>/ and queues the show-archive job,
// which moves the show's files (its episodes' audio, kept uploads and
// waveforms, its artwork and live recordings) in beside it. They're kept for
// deletedShowRetentionMs in case they're wanted back; then the daily
// deleted-purge job removes the folder for good. Never served.
import '@tanstack/react-start/server-only'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { localImageUrl } from '~/server/images.server'
import { logger } from '~/server/logger.server'
import {
  deletedShowDir,
  deletedShowsDir,
  episodeAudioPath,
  episodeSourcePath,
  episodeWaveformPath,
  imagePath,
  mediaDirs,
  showLiveRecordingsDir,
} from '~/server/storage.server'

export const deletedShowRetentionMs = 30 * 24 * 60 * 60 * 1000

// What the show was, so its files can be told apart and put back by hand.
export type DeletedShowManifest = {
  id: string
  title: string
  slug: string
  userId: string
  imageUrl: string | null
  deletedAt: string
  episodes: { id: string; title: string; slug: string; imageUrl: string | null }[]
}

const manifestName = 'manifest.json'

// Written as the show's row is deleted, before its files are moved, so the
// media clean-up (which removes files nothing refers to) leaves them alone
// until the job has run.
export async function writeDeletedShowManifest(manifest: DeletedShowManifest) {
  const dir = deletedShowDir(manifest.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, manifestName), JSON.stringify(manifest, null, 2))
}

async function readManifest(dir: string): Promise<DeletedShowManifest | null> {
  try {
    return JSON.parse(await readFile(join(dir, manifestName), 'utf8')) as DeletedShowManifest
  } catch {
    return null
  }
}

const imageIdOf = (url: string | null) => (url && localImageUrl.exec(url)?.[1]) || null

// Shows deleted but not yet purged, with their episodes and images, whose
// files the media clean-up must not remove.
export async function deletedShowMedia() {
  const showIds = new Set<string>()
  const episodeIds = new Set<string>()
  const imageIds = new Set<string>()
  for (const entry of await readdir(deletedShowsDir(), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    const manifest = await readManifest(join(deletedShowsDir(), entry.name))
    if (!manifest) continue
    showIds.add(manifest.id)
    for (const episode of manifest.episodes) {
      episodeIds.add(episode.id)
      const imageId = imageIdOf(episode.imageUrl)
      if (imageId) imageIds.add(imageId)
    }
    const imageId = imageIdOf(manifest.imageUrl)
    if (imageId) imageIds.add(imageId)
  }
  return { showIds, episodeIds, imageIds }
}

// Moves a file or folder into `dir`, if it's there. Copies when the two are on
// different file systems.
async function moveInto(dir: string, path: string) {
  if (!(await stat(path).catch(() => null))) return false
  await mkdir(dir, { recursive: true })
  const target = join(dir, basename(path))
  try {
    await rename(path, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await cp(path, target, { recursive: true })
    await rm(path, { recursive: true, force: true })
  }
  return true
}

// The show-archive job. Safe to run again: files already moved are skipped.
export async function archiveDeletedShow(showId: string) {
  const dir = deletedShowDir(showId)
  const manifest = await readManifest(dir)
  if (!manifest) {
    logger.warn({ showId }, 'No manifest for the deleted show; nothing to archive')
    return { moved: 0 }
  }
  let moved = 0
  const move = async (folder: string, path: string) => {
    if (await moveInto(join(dir, folder), path)) moved++
  }
  for (const episode of manifest.episodes) {
    await move('audio', episodeAudioPath(episode.id))
    await move('sources', episodeSourcePath(episode.id))
    await move('waveforms', episodeWaveformPath(episode.id))
  }
  const imageIds = [manifest.imageUrl, ...manifest.episodes.map((episode) => episode.imageUrl)].map(imageIdOf)
  for (const imageId of new Set(imageIds)) {
    if (!imageId) continue
    await move('images', imagePath(imageId))
    // Resized copies are made again on request, so aren't worth keeping.
    for (const name of await readdir(mediaDirs.imageVariants).catch(() => [])) {
      if (name.startsWith(`${imageId}-`)) await rm(join(mediaDirs.imageVariants, name), { force: true })
    }
  }
  await move('live-recordings', showLiveRecordingsDir(showId))
  logger.info({ showId, moved }, 'Archived a deleted show’s media')
  return { moved }
}

// The deleted-purge job: removes deleted shows' folders once they've been
// kept for the retention period (judged by the folder's age if its manifest
// is missing or unreadable).
export async function purgeDeletedShows(now = Date.now()) {
  let purged = 0
  for (const entry of await readdir(deletedShowsDir(), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    const dir = join(deletedShowsDir(), entry.name)
    const manifest = await readManifest(dir)
    const deletedAt = Date.parse(manifest?.deletedAt ?? '') || (await stat(dir)).mtimeMs
    if (now - deletedAt < deletedShowRetentionMs) continue
    await rm(dir, { recursive: true, force: true })
    logger.info({ showId: entry.name, title: manifest?.title }, 'Purged a deleted show’s media')
    purged++
  }
  return { purged }
}
