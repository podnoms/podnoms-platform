import { vi } from 'vitest'
import { makeImage } from './helpers'

let png: Buffer | undefined

// Pexels, Flickr and Wikimedia Commons searches answered from `results` (photo IDs by
// query), and their photos served, except those in `broken`.
export async function fakeSources(results: Record<string, (number | string)[]>, broken: string[] = []) {
  png ??= await makeImage(1400, 1400)
  const fetch = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.hostname === 'api.pexels.com') {
      const photos = (results[url.searchParams.get('query') ?? ''] ?? []).map((id) => ({
        id: Number(id),
        url: `https://www.pexels.com/photo/${id}/`,
        photographer: `Photographer ${id}`,
        photographer_url: `https://www.pexels.com/@p${id}`,
        src: { original: `https://images.pexels.test/${id}/original.jpeg`, medium: `https://images.pexels.test/${id}/medium.jpeg` },
      }))
      return Response.json({ photos })
    }
    if (url.hostname === 'api.flickr.com') {
      if (url.searchParams.get('api_key') === 'bad') return Response.json({ stat: 'fail', code: 100, message: 'Invalid API Key' })
      const photo = (results[url.searchParams.get('text') ?? ''] ?? []).map((id) => ({
        id: String(id),
        owner: `owner${id}`,
        ownername: id === 'anon' ? '' : `Owner ${id}`,
        // `small` stands for a photo too small to have the larger sizes.
        ...(String(id).startsWith('small') ? {} : { url_l: `https://live.staticflickr.test/${id}_b.jpg` }),
        url_n: `https://live.staticflickr.test/${id}_n.jpg`,
      }))
      return Response.json({ stat: 'ok', photos: { photo } })
    }
    if (url.hostname === 'commons.wikimedia.org') {
      const search = url.searchParams.get('gsrsearch') ?? ''
      // Searches carry the file type and licence filters after the words.
      const words = search.replace(/ filetype:.*$/, '')
      const pages = (results[words] ?? []).map((id, index) => ({
        pageid: id,
        index: index + 1,
        imageinfo: [
          {
            thumburl: `https://upload.wikimedia.test/${id}/1400px.jpg`,
            descriptionurl: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
            extmetadata: {
              ...(id === 'anon' ? {} : { Artist: { value: `<a href="//commons.wikimedia.org/wiki/User:U${id}">Creator ${id}</a>` } }),
              // `nc` stands for a file whose licence template isn't free after all.
              License: { value: String(id).startsWith('nc') ? 'cc-by-nc-4.0' : 'cc0' },
            },
          },
        ],
      }))
      // Listed out of order, as Commons does.
      return Response.json(pages.length ? { query: { pages: pages.reverse() } } : {})
    }
    if (broken.some((id) => url.pathname.includes(id))) return new Response('gone', { status: 404 })
    return new Response(new Uint8Array(png!))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

// The searches made, in order.
export const searches = (fetch: Awaited<ReturnType<typeof fakeSources>>) =>
  fetch.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.hostname.startsWith('api.') || url.pathname === '/w/api.php')
    .map(
      (url) =>
        url.searchParams.get('query') ??
        url.searchParams.get('text') ??
        url.searchParams.get('gsrsearch')?.replace(/ filetype:.*$/, ''),
    )
