import { afterEach, describe, expect, it, vi } from 'vitest'
import { flickr } from '~/server/image-sources/flickr.server'
import { fakeSources } from '../../fake-image-sources'

afterEach(() => vi.unstubAllGlobals())

describe('flickr', () => {
  it('searches safe CC0 and public-domain photos with the key, and credits them', async () => {
    const fetch = await fakeSources({ jazz: ['7'] })
    const [photo] = await flickr('test-key').search('jazz')

    const [url, init] = fetch.mock.calls[0]!
    expect(Object.fromEntries(new URL(String(url)).searchParams)).toMatchObject({
      method: 'flickr.photos.search',
      api_key: 'test-key',
      text: 'jazz',
      license: '9,10',
      safe_search: '1',
      sort: 'relevance',
    })
    expect(new Headers(init?.headers).get('user-agent')).toMatch(/PodNoms/)
    expect(photo).toEqual({
      id: '7',
      downloadUrl: 'https://live.staticflickr.test/7_b.jpg',
      previewUrl: 'https://live.staticflickr.test/7_n.jpg',
      credit: {
        author: 'Owner 7',
        authorUrl: 'https://www.flickr.com/photos/owner7/',
        pageUrl: 'https://www.flickr.com/photos/owner7/7/',
        source: 'Flickr',
        sourceUrl: 'https://www.flickr.com',
        preposition: 'on',
      },
    })
  })

  it('leaves out photos too small to have a large size, and credits no name when there is none', async () => {
    await fakeSources({ jazz: ['small1', 'anon'] })
    const photos = await flickr('test-key').search('jazz')
    expect(photos.map((photo) => photo.id)).toEqual(['anon'])
    expect(photos[0]!.credit.author).toBeNull()
  })

  it('reports an error Flickr sends in a successful response', async () => {
    await fakeSources({})
    await expect(flickr('bad').search('jazz')).rejects.toThrow('Flickr search failed: 100 Invalid API Key')
  })
})
