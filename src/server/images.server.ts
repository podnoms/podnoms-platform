// Podcast and episode artwork. Every image is stored as a square JPEG that
// podcast apps accept, in the media folder: uploads are staged until the edit
// form is saved, and artwork from sources such as YouTube is downloaded rather
// than linked to. Smaller copies are made on request (see imageVariant).
import '@tanstack/react-start/server-only'
import { readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { eq, like } from 'drizzle-orm'
import sharp from 'sharp'
import { openGraphImageSize } from '~/lib/images'
import { db } from '~/server/db/client.server'
import { episodes, podcasts } from '~/server/db/schema'
import { decodeImageToPng } from '~/server/media.server'
import {
  ensureImagesDir,
  ensureImageVariantsDir,
  ensureUserStagedImagesDir,
  imagePath,
  imageUrl,
  imageVariantPath,
  openGraphImagePath,
  removeStaleFiles,
  stagedImagePath,
} from '~/server/storage.server'
import { receiveFile, UploadError } from '~/server/uploads.server'

export const maxImageBytes = 20 * 1024 * 1024

// A stored image's URL, capturing its ID.
export const localImageUrl = /^\/images\/([0-9a-f-]{36})\.jpg$/

// Podcast apps want square artwork, 1400 to 3000px a side, as JPEG or PNG.
const minSide = 1400
const maxSide = 3000

async function writeArtwork(input: string, destination: string) {
  const image = sharp(input).rotate() // Apply the photo's EXIF orientation.
  const { width = 0, height = 0 } = await image.metadata()
  // Crop to a square from the middle; small images are scaled up to the minimum.
  const side = Math.min(maxSide, Math.max(minSide, Math.min(width, height)))
  await image
    // Artwork can't be transparent; put it on white rather than black.
    .flatten({ background: '#ffffff' })
    .resize(side, side, { fit: 'cover' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(destination)
}

// Converts an image file to artwork. Sharp reads the common formats; anything
// else that ffmpeg can decode is tried that way. Throws if it isn't an image.
export async function convertToArtwork(source: string, destination: string) {
  try {
    await writeArtwork(source, destination)
  } catch {
    const decoded = `${source}.png`
    try {
      await decodeImageToPng(source, decoded)
      await writeArtwork(decoded, destination)
    } finally {
      await rm(decoded, { force: true })
    }
  }
}

// Converts the uploaded image and stages it for the user. Returns its ID,
// which saving a podcast or episode with it turns into a stored image.
export async function stageImage(userId: string, body: ReadableStream<Uint8Array>) {
  const dir = await ensureUserStagedImagesDir(userId)
  void removeStaleFiles(dir).catch(() => {})
  const imageId = crypto.randomUUID()
  const original = `${stagedImagePath(userId, imageId)}.original`
  try {
    await receiveFile(body, original, maxImageBytes)
    await convertToArtwork(original, stagedImagePath(userId, imageId)).catch(() => {
      throw new UploadError("That file isn't an image we can read", 415)
    })
    return { imageId }
  } finally {
    await rm(original, { force: true })
  }
}

// Moves a staged image into the image store, returning its URL.
export async function commitImage(userId: string, imageId: string) {
  await ensureImagesDir()
  try {
    await rename(stagedImagePath(userId, imageId), imagePath(imageId))
  } catch {
    throw new Error('That image has expired. Please choose it again.')
  }
  return imageUrl(imageId)
}

// Removes a stored image; remote URLs (from before images were stored) are left alone.
export async function deleteImage(url: string | null | undefined) {
  const imageId = url && localImageUrl.exec(url)?.[1]
  if (!imageId) return
  await rm(imagePath(imageId), { force: true })
  const variants = await ensureImageVariantsDir()
  for (const name of await readdir(variants)) {
    if (name.startsWith(`${imageId}-`)) await rm(join(variants, name), { force: true })
  }
}

// The widths smaller copies are made at. Requests are rounded up to one of
// these, so the number of copies per image stays small.
export const imageWidths = [64, 128, 256, 512, 1024] as const

// Copies being made right now, so simultaneous requests share the work.
const making = new Map<string, Promise<void>>()

// The path to the image at the given width, made the first time it's asked for.
// Null when the image doesn't exist. Widths beyond the largest get the original.
export async function imageVariant(imageId: string, requestedWidth: number, format: 'jpg' | 'webp') {
  const original = imagePath(imageId)
  if (!(await stat(original).catch(() => null))) return null
  const width = imageWidths.find((w) => w >= requestedWidth)
  if (!width) return { path: original, format: 'jpg' as const }

  const path = imageVariantPath(imageId, width, format)
  await makeOnce(path, (partial) => {
    const resized = sharp(original).resize(width, width, { fit: 'cover' })
    return (format === 'webp' ? resized.webp({ quality: 80 }) : resized.jpeg({ quality: 82, mozjpeg: true })).toFile(partial)
  })
  return { path, format }
}

// The image for link previews (Open Graph), made the first time it's asked for:
// a 1.91:1 JPEG, the shape Facebook, LinkedIn and X show large, with the square
// artwork in the middle of a blurred copy of itself, so cropping it to 2:1 (as
// X does) loses nothing. Null when the image doesn't exist.
export async function openGraphImage(imageId: string) {
  const original = imagePath(imageId)
  if (!(await stat(original).catch(() => null))) return null
  const path = openGraphImagePath(imageId)
  await makeOnce(path, async (partial) => {
    const { width, height } = openGraphImageSize
    const artworkSide = height - 2 * 60
    const [background, artwork] = await Promise.all([
      sharp(original).resize(width, height, { fit: 'cover' }).blur(40).modulate({ brightness: 0.8 }).toBuffer(),
      sharp(original).resize(artworkSide, artworkSide).toBuffer(),
    ])
    await sharp(background)
      .composite([{ input: artwork, gravity: 'center' }])
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(partial)
  })
  return path
}

// Writes the file at `path` with `write` unless it's there already. It's written
// under another name first, so a half-written copy is never served.
async function makeOnce(path: string, write: (partial: string) => Promise<unknown>) {
  if (await stat(path).catch(() => null)) return
  let pending = making.get(path)
  if (!pending) {
    pending = (async () => {
      await ensureImageVariantsDir()
      const partial = `${path}.${crypto.randomUUID()}.partial`
      try {
        await write(partial)
        await rename(partial, path)
      } finally {
        await rm(partial, { force: true })
      }
    })().finally(() => making.delete(path))
    making.set(path, pending)
  }
  await pending
}

// Downloads an image, e.g. a video's thumbnail, into the image store.
// Returns its URL, or null if it couldn't be fetched or isn't an image.
export async function downloadImage(remoteUrl: string) {
  const imageId = crypto.randomUUID()
  await ensureImagesDir()
  const original = `${imagePath(imageId)}.original`
  try {
    const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok || !response.body) return null
    await receiveFile(response.body, original, maxImageBytes)
    await convertToArtwork(original, imagePath(imageId))
    return imageUrl(imageId)
  } catch {
    return null
  } finally {
    await rm(original, { force: true })
  }
}

// Downloads artwork that podcasts and episodes still link to remotely, from
// before images were stored. Runs once, in the background, after the server starts.
let localised = false
export async function localiseRemoteImages() {
  if (localised) return
  localised = true
  const remotePodcasts = like(podcasts.imageUrl, 'http%')
  for (const row of await db.select({ id: podcasts.id, imageUrl: podcasts.imageUrl }).from(podcasts).where(remotePodcasts)) {
    const url = await downloadImage(row.imageUrl!)
    if (url) await db.update(podcasts).set({ imageUrl: url }).where(eq(podcasts.id, row.id))
  }
  const remoteEpisodes = like(episodes.imageUrl, 'http%')
  for (const row of await db.select({ id: episodes.id, imageUrl: episodes.imageUrl }).from(episodes).where(remoteEpisodes)) {
    const url = await downloadImage(row.imageUrl!)
    if (url) await db.update(episodes).set({ imageUrl: url }).where(eq(episodes.id, row.id))
  }
}
