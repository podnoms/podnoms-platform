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
// Episode waveforms, as JSON (see waveforms.server.ts).
const waveformsDir = resolve(env.MEDIA_DIR, 'waveforms')
// Live broadcasts as MediaMTX records them, one folder per podcast under
// "live/" (its path names), until they're made into episodes (see
// live-recordings.server.ts). MediaMTX must write to the same place.
const liveRecordingsDir = resolve(env.MEDIA_DIR, 'live-recordings')
// The site's uploaded logo and the icons made from it (see branding.server.ts).
const brandingDir = resolve(env.MEDIA_DIR, 'branding')
// The theme's Google Fonts, one folder per font (see fonts.server.ts).
const fontsDir = resolve(env.MEDIA_DIR, 'fonts')
// MaxMind's GeoLite2 database, downloaded by geoip.server.ts.
const geoipDir = resolve(env.MEDIA_DIR, 'geoip')

// Every folder above, for the media clean-up job (see media-cleanup.server.ts).
export const mediaDirs = {
  audio: audioDir,
  uploads: uploadsDir,
  sources: sourcesDir,
  images: imagesDir,
  imageVariants: join(imagesDir, 'variants'),
  stagedImages: stagedImagesDir,
  waveforms: waveformsDir,
  liveRecordings: liveRecordingsDir,
}

export async function ensureBrandingDir() {
  await mkdir(brandingDir, { recursive: true })
  return brandingDir
}

// The logo as uploaded (made square), one file per version.
export function brandLogoPath(version: string) {
  return join(brandingDir, `logo-${safeId(version)}.png`)
}

// The logo (`version`, or "default") resized to `size` (or as the link
// preview card, "og"), made on request.
export function brandIconPath(version: string, size: number | 'og') {
  return join(brandingDir, `icon-${safeId(version)}-${size}.png`)
}

export async function ensureFontDir(slug: string) {
  const dir = join(fontsDir, safeId(slug))
  await mkdir(dir, { recursive: true })
  return dir
}

// A font's file: its stylesheet (font.css) or one of the font files it names.
export function fontFilePath(slug: string, file: string) {
  if (!/^[\w-]+\.(css|woff2)$/.test(file)) throw new Error(`Invalid font file: ${file}`)
  return join(fontsDir, safeId(slug), file)
}

export const geoipDatabasePath = join(geoipDir, 'GeoLite2-City.mmdb')

export async function ensureGeoipDir() {
  await mkdir(geoipDir, { recursive: true })
  return geoipDir
}

export async function ensureAudioDir() {
  await mkdir(audioDir, { recursive: true })
  return audioDir
}

export function episodeAudioPath(episodeId: string) {
  return join(audioDir, `${episodeId}.mp3`)
}

// New audio for the episode, made alongside its current audio, which it
// replaces once it's ready. Without the extension, as yt-dlp adds that.
export function replacementAudioName(episodeId: string) {
  return `${episodeId}.replacement`
}

export function replacementAudioPath(episodeId: string) {
  return join(audioDir, `${replacementAudioName(episodeId)}.mp3`)
}

export function episodeWaveformPath(episodeId: string) {
  return join(waveformsDir, `${safeId(episodeId)}.json`)
}

// Replaced audio gets a version in its URL, so podcast apps and browsers that
// already have the old audio fetch the new.
export function episodeAudioUrl(episodeId: string, version?: string) {
  const url = `/api/episodes/${episodeId}/audio`
  return version ? `${url}?v=${version}` : url
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

// Where MediaMTX records the podcast's broadcasts (its path is "live/<podcast id>").
export function podcastLiveRecordingsDir(podcastId: string) {
  return join(liveRecordingsDir, 'live', safeId(podcastId))
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

// The image laid out for link previews (see openGraphImage).
export function openGraphImagePath(imageId: string) {
  return join(imagesDir, 'variants', `${safeId(imageId)}-og.jpg`)
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
