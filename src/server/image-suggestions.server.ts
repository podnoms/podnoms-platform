// Finds artwork to suggest for a podcast or episode and stages it as if it
// had been uploaded: it's kept only if the form is saved with it (see
// images.server.ts). Photos come from the first source in `imageSources`
// that's configured (see image-sources/).
import '@tanstack/react-start/server-only'
import { env } from '~/env'
import { imageSearchQueries, type ImageSuggestionInput } from '~/lib/image-search'
import { siteUserAgent } from '~/server/branding.server'
import { ExpiringStore } from '~/server/expiring-store.server'
import { commons } from '~/server/image-sources/commons.server'
import { flickr } from '~/server/image-sources/flickr.server'
import type { ImageCredit, ImageSource, Photo } from '~/server/image-sources/image-source.server'
import { pexels } from '~/server/image-sources/pexels.server'
import { ImageRejectedError, stageImage } from '~/server/images.server'
import { reportError } from '~/server/logger.server'

export type { ImageCredit }

export type ImageSuggestion = {
  imageId: string
  // The source's own smaller copy, to show until the form is saved.
  previewUrl: string
  photoId: string
  credit: ImageCredit
}

export class ImageSuggestionError extends Error {}

type SourceConfig = Pick<typeof env, 'PEXELS_API_KEY' | 'FLICKR_API_KEY'>

// Sources in order of preference, each null when it isn't configured. To
// change source, set a different key or reorder this list.
const imageSources: ((config: SourceConfig) => ImageSource | null)[] = [
  (config) => (config.PEXELS_API_KEY ? pexels(config.PEXELS_API_KEY) : null),
  (config) => (config.FLICKR_API_KEY ? flickr(config.FLICKR_API_KEY) : null),
  () => commons,
]

export function imageSource(config: SourceConfig = env): ImageSource {
  return imageSources.map((source) => source(config)).find((source) => source !== null) ?? commons
}

// Searches are kept for a day, saving the sources' quotas.
const searches = new ExpiringStore<Photo[]>(24 * 60 * 60 * 1000)

async function search(source: ImageSource, query: string) {
  const key = `${source.name}:${query}`
  const cached = searches.get(key)
  if (cached) return cached
  const photos = await source.search(query)
  searches.set(key, photos)
  return photos
}

// Sources list the best matches first, so the pick is from the top few, to
// keep it on topic.
const poolSize = 15

// Photos are fetched from wherever the source keeps them, which sometimes
// fails (gone, too big, not an image); a few others are tried before giving up.
const downloadAttempts = 3

// A photo suiting what's known so far, other than those already suggested.
export async function suggestImage(
  userId: string,
  input: ImageSuggestionInput,
  source = imageSource(),
): Promise<ImageSuggestion> {
  const exclude = new Set(input.exclude ?? [])
  let attempts = 0
  for (const query of imageSearchQueries(input)) {
    let found: Photo[]
    try {
      found = await search(source, query)
    } catch (error) {
      // Usually a missing or refused key, or the source limiting us.
      reportError(error, { source: source.name, query, msg: 'Image search failed' })
      throw new ImageSuggestionError("Image search isn't available just now. Please try again later.")
    }
    const photos = found.filter((photo) => !exclude.has(photo.id)).slice(0, poolSize)
    while (photos.length > 0 && attempts < downloadAttempts) {
      const [photo] = photos.splice(Math.floor(Math.random() * photos.length), 1)
      attempts++
      try {
        const response = await fetch(photo!.downloadUrl, {
          headers: { 'User-Agent': await siteUserAgent() },
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        const { imageId } = await stageImage(userId, response.body)
        return { imageId, previewUrl: photo!.previewUrl, photoId: photo!.id, credit: photo!.credit }
      } catch (error) {
        // A photo the image check refused is just skipped.
        if (!(error instanceof ImageRejectedError)) {
          reportError(error, { source: source.name, url: photo!.downloadUrl, msg: 'Could not download a suggested image' })
        }
        exclude.add(photo!.id)
      }
    }
    if (attempts >= downloadAttempts) throw new ImageSuggestionError("Couldn't fetch an image just now. Please try again.")
  }
  throw new ImageSuggestionError("Couldn't find any more images. Try changing the title.")
}
