import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatGifSchema, fromGiphy, fromKlipy, isProviderMediaUrl, searchGifs } from '~/lib/gifs'
import { postChatSchema } from '~/lib/live-schema'

afterEach(() => vi.restoreAllMocks())

// A KLIPY item in the shape of its docs' example (docs.klipy.com/gifs-api).
const klipyFile = (name: string) => ({
  gif: { url: `https://static.klipy.com/ii/abc/${name}.gif`, width: 220, height: 124, size: 1000 },
  webp: { url: `https://static.klipy.com/ii/abc/${name}.webp`, width: 220, height: 124, size: 500 },
})
const klipyItem = { id: 7, slug: 'happy-dance', title: 'Happy dance', file: { hd: klipyFile('hd'), md: klipyFile('md'), sm: klipyFile('sm'), xs: klipyFile('xs') }, type: 'gif' }

const giphyImage = (name: string) => ({
  url: `https://media2.giphy.com/media/xyz/${name}.gif?cid=abc&rid=${name}.gif&ct=g`,
  webp: `https://media2.giphy.com/media/xyz/${name}.webp?cid=abc&rid=${name}.webp&ct=g`,
  width: '200',
  height: '150',
})
const giphyItem = { id: 'xyz', title: 'Wave GIF', images: { fixed_width: giphyImage('200w'), fixed_width_small: giphyImage('100w') } }

describe('provider media URLs', () => {
  it("only accepts HTTPS URLs on the provider's own media servers", () => {
    expect(isProviderMediaUrl('klipy', 'https://static.klipy.com/ii/a.gif')).toBe(true)
    expect(isProviderMediaUrl('klipy', 'https://static2.klipy.com/ii/a.gif')).toBe(true)
    expect(isProviderMediaUrl('giphy', 'https://media4.giphy.com/media/a/200w.webp')).toBe(true)
    expect(isProviderMediaUrl('giphy', 'https://i.giphy.com/a.gif')).toBe(true)

    expect(isProviderMediaUrl('klipy', 'http://static.klipy.com/ii/a.gif')).toBe(false)
    expect(isProviderMediaUrl('klipy', 'https://media2.giphy.com/a.gif')).toBe(false)
    expect(isProviderMediaUrl('giphy', 'https://evil.example/media.giphy.com.gif')).toBe(false)
    expect(isProviderMediaUrl('giphy', 'https://media.giphy.com.evil.example/a.gif')).toBe(false)
    expect(isProviderMediaUrl('giphy', 'not a url')).toBe(false)
  })

  it('are checked when a GIF is sent', () => {
    const gif = { provider: 'giphy' as const, id: 'a', title: '', url: 'https://media.giphy.com/a.gif', width: 200, height: 150 }
    expect(chatGifSchema.safeParse(gif).success).toBe(true)
    expect(chatGifSchema.safeParse({ ...gif, url: 'https://tracker.example/pixel.gif' }).success).toBe(false)
    expect(chatGifSchema.safeParse({ ...gif, provider: 'tenor' }).success).toBe(false)
  })
})

describe('chat messages', () => {
  const gif = { provider: 'klipy' as const, id: 'a', title: '', url: 'https://static.klipy.com/a.gif', width: 1, height: 1 }

  it('need some text, a GIF, or both', () => {
    expect(postChatSchema.safeParse({ broadcastId: 'b', body: 'hi' }).success).toBe(true)
    expect(postChatSchema.safeParse({ broadcastId: 'b', gif }).success).toBe(true)
    expect(postChatSchema.safeParse({ broadcastId: 'b', body: 'hi', gif }).success).toBe(true)
    expect(postChatSchema.safeParse({ broadcastId: 'b', body: '   ' }).success).toBe(false)
    expect(postChatSchema.safeParse({ broadcastId: 'b' }).success).toBe(false)
  })
})

describe('fromKlipy', () => {
  it('uses the medium WebP to send and the extra-small one to preview, with the URLs as given', () => {
    const page = fromKlipy({ data: { data: [klipyItem], current_page: 2, has_next: true } })
    expect(page).toEqual({
      results: [
        {
          provider: 'klipy',
          id: 'happy-dance',
          title: 'Happy dance',
          url: 'https://static.klipy.com/ii/abc/md.webp',
          width: 220,
          height: 124,
          preview: { url: 'https://static.klipy.com/ii/abc/xs.webp', width: 220, height: 124 },
        },
      ],
      next: 3,
    })
  })

  it('skips items without files, and stops at the last page', () => {
    const page = fromKlipy({ data: { data: [{ id: 1, title: 'An ad' }], current_page: 1, has_next: false } })
    expect(page).toEqual({ results: [], next: null })
  })
})

describe('fromGiphy', () => {
  it('uses the fixed-width WebP to send and the small one to preview, with the URLs as given', () => {
    const page = fromGiphy({ data: [giphyItem], pagination: { offset: 0, count: 1, total_count: 30 } })
    expect(page.results).toEqual([
      {
        provider: 'giphy',
        id: 'xyz',
        title: 'Wave GIF',
        url: giphyImage('200w').webp,
        width: 200,
        height: 150,
        preview: { url: giphyImage('100w').webp, width: 200, height: 150 },
      },
    ])
    expect(page.next).toBe(1)
  })

  it('stops at the last page', () => {
    expect(fromGiphy({ data: [giphyItem], pagination: { offset: 29, count: 1, total_count: 30 } }).next).toBeNull()
    expect(fromGiphy({ data: [], pagination: { offset: 0, count: 0, total_count: 0 } }).next).toBeNull()
  })
})

describe('searchGifs', () => {
  const respond = (body: unknown) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(body))

  it('searches KLIPY with the key in the path and its medium content filter, trending when there is no query', async () => {
    const fetch = respond({ data: { data: [klipyItem], current_page: 1, has_next: false } })
    await searchGifs({ provider: 'klipy', key: 'k1' }, ' party ')
    const search = new URL(String(fetch.mock.calls[0]![0]))
    expect(search.origin + search.pathname).toBe('https://api.klipy.com/api/v1/k1/gifs/search')
    expect(Object.fromEntries(search.searchParams)).toMatchObject({ q: 'party', page: '1', content_filter: 'medium' })

    await searchGifs({ provider: 'klipy', key: 'k1' }, '', 2)
    const trending = new URL(String(fetch.mock.calls[1]![0]))
    expect(trending.pathname).toBe('/api/v1/k1/gifs/trending')
    expect(trending.searchParams.get('page')).toBe('2')
    expect(trending.searchParams.has('q')).toBe(false)
  })

  it('searches GIPHY rated PG-13, paging by offset', async () => {
    const fetch = respond({ data: [giphyItem], pagination: { offset: 24, count: 1, total_count: 100 } })
    await searchGifs({ provider: 'giphy', key: 'g1' }, 'wave', 24)
    const url = new URL(String(fetch.mock.calls[0]![0]))
    expect(url.origin + url.pathname).toBe('https://api.giphy.com/v1/gifs/search')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ api_key: 'g1', q: 'wave', offset: '24', rating: 'pg-13' })
  })

  it('throws when the provider refuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }))
    await expect(searchGifs({ provider: 'giphy', key: 'bad' }, 'x')).rejects.toThrow('GIF search failed (401)')
  })
})
