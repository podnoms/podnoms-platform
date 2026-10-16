import '@tanstack/react-start/server-only'
import type { ImageSource } from '~/server/image-sources/image-source.server'

type PexelsPhoto = {
  id: number
  url: string
  photographer: string
  photographer_url: string
  src: { original: string; medium: string }
}

// Pexels (pexels.com/api): 200 searches an hour.
export function pexels(apiKey: string): ImageSource {
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
            preposition: 'on',
          },
        }
      })
    },
  }
}
