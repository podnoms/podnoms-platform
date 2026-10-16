import '@tanstack/react-start/server-only'
import { userAgent, type ImageSource } from '~/server/image-sources/image-source.server'

type FlickrPhoto = {
  id: string
  owner: string
  ownername?: string
  // Sizes Flickr has for the photo; small originals lack the larger ones.
  url_l?: string
  url_c?: string
  url_z?: string
  url_n?: string
  url_m?: string
}

type FlickrResponse = { stat: 'ok'; photos: { photo: FlickrPhoto[] } } | { stat: 'fail'; code: number; message: string }

// Flickr licence IDs (flickr.photos.licenses.getInfo): CC0 and the Public
// Domain Mark, so photos are free to keep without credit.
const freeLicenses = '9,10'

// Flickr (flickr.com/services/api): 3,600 requests an hour per key.
export function flickr(apiKey: string): ImageSource {
  return {
    name: 'flickr',
    async search(query) {
      const url = new URL('https://api.flickr.com/services/rest/')
      url.search = new URLSearchParams({
        method: 'flickr.photos.search',
        api_key: apiKey,
        text: query,
        license: freeLicenses,
        content_types: '0',
        media: 'photos',
        safe_search: '1',
        sort: 'relevance',
        per_page: '80',
        extras: 'owner_name,url_l,url_c,url_z,url_n,url_m',
        format: 'json',
        nojsoncallback: '1',
      }).toString()
      const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`Flickr search failed: ${response.status} ${(await response.text()).slice(0, 200)}`)
      // Flickr reports errors, such as a bad key, in a 200 response.
      const body = (await response.json()) as FlickrResponse
      if (body.stat !== 'ok') throw new Error(`Flickr search failed: ${body.code} ${body.message}`)
      return body.photos.photo.flatMap((photo) => {
        // Up to 1024px; staging crops it square.
        const downloadUrl = photo.url_l ?? photo.url_c ?? photo.url_z
        if (!downloadUrl) return []
        return [
          {
            id: photo.id,
            downloadUrl,
            previewUrl: photo.url_n ?? photo.url_m ?? downloadUrl,
            credit: {
              author: photo.ownername || null,
              authorUrl: `https://www.flickr.com/photos/${photo.owner}/`,
              pageUrl: `https://www.flickr.com/photos/${photo.owner}/${photo.id}/`,
              source: 'Flickr',
              sourceUrl: 'https://www.flickr.com',
              preposition: 'on',
            },
          },
        ]
      })
    },
  }
}
