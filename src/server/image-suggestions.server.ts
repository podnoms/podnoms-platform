// Finds artwork to suggest for a podcast or episode and stages it as if it
// had been uploaded: it's kept only if the form is saved with it (see
// images.server.ts). Photos come from Pexels when PEXELS_API_KEY is set, and
// otherwise from Openverse, which needs no key, limited to public-domain and
// CC0 photos so they're free to keep without credit.
import '@tanstack/react-start/server-only'
import { env } from '~/env'
import { imageSearchQueries, type ImageSuggestionInput } from '~/lib/image-search'
import { ExpiringStore } from '~/server/expiring-store.server'
import { stageImage } from '~/server/images.server'

export type ImageCredit = {
  author: string | null
  authorUrl: string | null
  pageUrl: string
  source: 'Pexels' | 'Openverse'
  sourceUrl: string
}

type Photo = {
  id: string
  // A copy suitable for artwork, to download and keep.
  downloadUrl: string
  previewUrl: string
  credit: ImageCredit
}

type ImageSource = { name: string; search: (query: string) => Promise<Photo[]> }

export type ImageSuggestion = {
  imageId: string
  // The source's own smaller copy, to show until the form is saved.
  previewUrl: string
  photoId: string
  credit: ImageCredit
}

export class ImageSuggestionError extends Error {}

const userAgent = 'PodNoms (https://podnoms.com)'

export function pexels(apiKey: string): ImageSource {
  type PexelsPhoto = {
    id: number
    url: string
    photographer: string
    photographer_url: string
    src: { original: string; medium: string }
  }
  return {
    name: 'pexels',
    async search(query) {
      const url = new URL('https://api.pexels.com/v1/search')
      url.search = new URLSearchParams({ query, per_page: '80', size: 'large' }).toString()
      const response = await fetch(url, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`Pexels search failed: ${response.status} ${(await response.text()).slice(0, 200)}`)
      const { photos } = (await response.json()) as { photos: PexelsPhoto[] }
      return photos.map((photo) => {
        // Pexels crops and resizes on request: square, at the size podcast apps want.
        const download = new URL(photo.src.original)
        download.search = new URLSearchParams({ auto: 'compress', cs: 'tinysrgb', fit: 'crop', w: '1400', h: '1400' }).toString()
        return {
          id: String(photo.id),
          downloadUrl: download.toString(),
          previewUrl: photo.src.medium,
          credit: {
            author: photo.photographer,
            authorUrl: photo.photographer_url,
            pageUrl: photo.url,
            source: 'Pexels',
            sourceUrl: 'https://www.pexels.com',
          },
        }
      })
    },
  }
}

export const openverse: ImageSource = {
  name: 'openverse',
  async search(query) {
    type OpenverseImage = {
      id: string
      url: string
      thumbnail: string
      foreign_landing_url: string
      creator: string | null
      creator_url: string | null
    }
    const url = new URL('https://api.openverse.org/v1/images/')
    url.search = new URLSearchParams({
      q: query,
      // Free to use and keep without credit.
      license: 'cc0,pdm',
      category: 'photograph',
      size: 'large',
      mature: 'false',
      page_size: '20',
    }).toString()
    const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Openverse search failed: ${response.status} ${(await response.text()).slice(0, 200)}`)
    const { results } = (await response.json()) as { results: OpenverseImage[] }
    return results.map((image) => ({
      id: image.id,
      downloadUrl: image.url,
      previewUrl: image.thumbnail,
      credit: {
        author: image.creator,
        authorUrl: image.creator_url,
        pageUrl: image.foreign_landing_url,
        source: 'Openverse',
        sourceUrl: 'https://openverse.org',
      },
    }))
  },
}

// Searches are kept for a day, saving the sources' quotas (Openverse allows
// 200 searches a day without a key, Pexels 200 an hour).
const searches = new ExpiringStore<Photo[]>(24 * 60 * 60 * 1000)

async function search(source: ImageSource, query: string) {
  const key = `${source.name}:${query}`
  const cached = searches.get(key)
  if (cached) return cached
  const photos = await source.search(query)
  searches.set(key, photos)
  return photos
}

export function imageSource(): ImageSource {
  return env.PEXELS_API_KEY ? pexels(env.PEXELS_API_KEY) : openverse
}

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
    const photos = (await search(source, query)).filter((photo) => !exclude.has(photo.id))
    while (photos.length > 0 && attempts < downloadAttempts) {
      const [photo] = photos.splice(Math.floor(Math.random() * photos.length), 1)
      attempts++
      try {
        const response = await fetch(photo!.downloadUrl, {
          headers: { 'User-Agent': userAgent },
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        const { imageId } = await stageImage(userId, response.body)
        return { imageId, previewUrl: photo!.previewUrl, photoId: photo!.id, credit: photo!.credit }
      } catch {
        exclude.add(photo!.id)
      }
    }
    if (attempts >= downloadAttempts) throw new ImageSuggestionError("Couldn't fetch an image just now. Please try again.")
  }
  throw new ImageSuggestionError("Couldn't find any more images. Try changing the title.")
}
