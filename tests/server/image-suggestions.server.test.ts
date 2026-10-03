import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageSuggestionError, imageSource, openverse, pexels, suggestImage } from '~/server/image-suggestions.server'
import { stagedImagePath } from '~/server/storage.server'
import { exists, makeImage } from '../helpers'

let png: Buffer
beforeEach(async () => {
  png ??= await makeImage(1400, 1400)
})
afterEach(() => vi.unstubAllGlobals())

// Pexels and Openverse searches answered from `results` (photo IDs by query),
// and their photos served, except those in `broken`.
function fakeSources(results: Record<string, (number | string)[]>, broken: string[] = []) {
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
    if (url.hostname === 'api.openverse.org') {
      const images = (results[url.searchParams.get('q') ?? ''] ?? []).map((id) => ({
        id: String(id),
        url: `https://photos.test/${id}.jpg`,
        thumbnail: `https://api.openverse.org/v1/images/${id}/thumb/`,
        foreign_landing_url: `https://photos.test/page/${id}`,
        creator: id === 'anon' ? null : `Creator ${id}`,
        creator_url: null,
      }))
      return Response.json({ result_count: images.length, results: images })
    }
    if (broken.some((id) => url.pathname.includes(id))) return new Response('gone', { status: 404 })
    return new Response(new Uint8Array(png))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const searches = (fetch: ReturnType<typeof fakeSources>) =>
  fetch.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((url) => url.hostname.startsWith('api.'))
    .map((url) => url.searchParams.get('q') ?? url.searchParams.get('query'))

describe('the Openverse source', () => {
  it('searches public-domain and CC0 photos only, and credits them', async () => {
    const fetch = fakeSources({ jazz: ['a1'] })
    const [photo] = await openverse.search('jazz')

    const [url, init] = fetch.mock.calls[0]!
    expect(Object.fromEntries(new URL(String(url)).searchParams)).toMatchObject({
      q: 'jazz',
      license: 'cc0,pdm',
      category: 'photograph',
      mature: 'false',
    })
    expect(new Headers(init?.headers).get('user-agent')).toMatch(/PodNoms/)
    expect(photo).toEqual({
      id: 'a1',
      downloadUrl: 'https://photos.test/a1.jpg',
      previewUrl: 'https://api.openverse.org/v1/images/a1/thumb/',
      credit: {
        author: 'Creator a1',
        authorUrl: null,
        pageUrl: 'https://photos.test/page/a1',
        source: 'Openverse',
        sourceUrl: 'https://openverse.org',
      },
    })
  })
})

describe('the Pexels source', () => {
  it('searches with the key, and downloads photos cropped square', async () => {
    const fetch = fakeSources({ jazz: [11] })
    const [photo] = await pexels('test-key').search('jazz')

    expect(new Headers(fetch.mock.calls[0]![1]?.headers).get('authorization')).toBe('test-key')
    const download = new URL(photo!.downloadUrl)
    expect(download.pathname).toBe('/11/original.jpeg')
    expect(Object.fromEntries(download.searchParams)).toMatchObject({ fit: 'crop', w: '1400', h: '1400' })
    expect(photo!.credit).toEqual({
      author: 'Photographer 11',
      authorUrl: 'https://www.pexels.com/@p11',
      pageUrl: 'https://www.pexels.com/photo/11/',
      source: 'Pexels',
      sourceUrl: 'https://www.pexels.com',
    })
  })
})

describe('imageSource', () => {
  it('is Openverse without a Pexels key', () => {
    expect(imageSource()).toBe(openverse)
  })
})

describe('suggestImage', () => {
  it('stages a photo matching the title, with its credit', async () => {
    fakeSources({ 'deep jazz': ['b1'] })
    const suggestion = await suggestImage('user-1', { title: 'Deep Jazz' }, openverse)
    expect(suggestion).toMatchObject({
      imageId: expect.any(String),
      previewUrl: 'https://api.openverse.org/v1/images/b1/thumb/',
      photoId: 'b1',
      credit: { author: 'Creator b1', source: 'Openverse' },
    })
    expect(await exists(stagedImagePath('user-1', suggestion.imageId))).toBe(true)
  })

  it('tries broader searches until one finds something', async () => {
    const fetch = fakeSources({ sunset: ['c1'] })
    expect((await suggestImage('user-1', { title: 'Muraku Sunset' }, openverse)).photoId).toBe('c1')
    expect(searches(fetch)).toEqual(['muraku sunset', 'muraku', 'sunset'])
  })

  it('suggests a different photo each time, then says when it has run out', async () => {
    fakeSources({ ocean: ['d1', 'd2'] })
    const first = await suggestImage('user-1', { title: 'Ocean' }, openverse)
    const second = await suggestImage('user-1', { title: 'Ocean', exclude: [first.photoId] }, openverse)
    expect([first.photoId, second.photoId].sort()).toEqual(['d1', 'd2'])
    await expect(suggestImage('user-1', { title: 'Ocean', exclude: ['d1', 'd2'] }, openverse)).rejects.toThrow(
      "Couldn't find any more images",
    )
  })

  it('tries another photo when one fails to download', async () => {
    fakeSources({ desert: ['gone1', 'e2'] }, ['gone1'])
    expect((await suggestImage('user-1', { title: 'Desert' }, openverse)).photoId).toBe('e2')
  })

  it('gives up after a few failed downloads', async () => {
    fakeSources({ canyon: ['gone2', 'gone3', 'gone4', 'f4'] }, ['gone2', 'gone3', 'gone4'])
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      await expect(suggestImage('user-1', { title: 'Canyon' }, openverse)).rejects.toThrow(ImageSuggestionError)
    } finally {
      random.mockRestore()
    }
  })

  it('keeps searches for a day, to save the quota', async () => {
    const fetch = fakeSources({ forest: ['g1', 'g2', 'g3'] })
    await suggestImage('user-1', { title: 'Forest' }, openverse)
    await suggestImage('user-1', { title: 'Forest' }, openverse)
    expect(searches(fetch)).toEqual(['forest'])
  })
})
