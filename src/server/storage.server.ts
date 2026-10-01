import '@tanstack/react-start/server-only'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { env } from '~/env'

const audioDir = resolve(env.MEDIA_DIR, 'audio')
// Files users have uploaded but not yet turned into an episode, one folder per user.
const uploadsDir = resolve(env.MEDIA_DIR, 'uploads')
// Uploaded files waiting to be converted, kept until the episode is ready so a
// failed conversion can be retried.
const sourcesDir = resolve(env.MEDIA_DIR, 'sources')
// Podcast and episode artwork, as JPEGs.
const imagesDir = resolve(env.MEDIA_DIR, 'images')
// Images users have uploaded but not yet saved to a podcast or episode.
const stagedImagesDir = resolve(env.MEDIA_DIR, 'staged-images')

export async function ensureAudioDir() {
  await mkdir(audioDir, { recursive: true })
  return audioDir
}

export function episodeAudioPath(episodeId: string) {
  return join(audioDir, `${episodeId}.mp3`)
}

export function episodeAudioUrl(episodeId: string) {
  return `/api/episodes/${episodeId}/audio`
}

export async function ensureUserUploadsDir(userId: string) {
  const dir = userUploadsDir(userId)
  await mkdir(dir, { recursive: true })
  return dir
}

// IDs become file names, so only ever accept plain ones.
function safeId(id: string) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid ID: ${id}`)
  return id
}

// Deletes files in the folder that haven't changed for a day: uploads that
// were never used.
export async function removeStaleFiles(dir: string) {
  const now = Date.now()
  for (const name of await readdir(dir)) {
    const path = join(dir, name)
    const modified = await stat(path).then((s) => s.mtimeMs, () => now)
    if (now - modified > 24 * 60 * 60 * 1000) await rm(path, { force: true })
  }
}

export function userUploadsDir(userId: string) {
  return join(uploadsDir, safeId(userId))
}

export function stagedUploadPath(userId: string, uploadId: string) {
  return join(userUploadsDir(userId), safeId(uploadId))
}

export async function ensureSourcesDir() {
  await mkdir(sourcesDir, { recursive: true })
  return sourcesDir
}

export function episodeSourcePath(episodeId: string) {
  return join(sourcesDir, safeId(episodeId))
}

export async function ensureImagesDir() {
  await mkdir(imagesDir, { recursive: true })
  return imagesDir
}

export function imagePath(imageId: string) {
  return join(imagesDir, `${safeId(imageId)}.jpg`)
}

// Resized copies of images, made on request. They can be deleted at any time.
export async function ensureImageVariantsDir() {
  const dir = join(imagesDir, 'variants')
  await mkdir(dir, { recursive: true })
  return dir
}

export function imageVariantPath(imageId: string, width: number, extension: 'jpg' | 'webp') {
  return join(imagesDir, 'variants', `${safeId(imageId)}-${width}.${extension}`)
}

export function imageUrl(imageId: string) {
  return `/images/${imageId}.jpg`
}

export async function ensureUserStagedImagesDir(userId: string) {
  const dir = join(stagedImagesDir, safeId(userId))
  await mkdir(dir, { recursive: true })
  return dir
}

export function stagedImagePath(userId: string, imageId: string) {
  return join(stagedImagesDir, safeId(userId), `${safeId(imageId)}.jpg`)
}
