import { afterEach, describe, expect, it, vi } from 'vitest'
import { commons } from '~/server/image-sources/commons.server'
import { fakeSources } from '../../fake-image-sources'

afterEach(() => vi.unstubAllGlobals())

describe('commons', () => {
  it('searches CC0 and public-domain images, best match first, and credits them', async () => {
    const fetch = await fakeSources({ jazz: ['1', '2'] })
    const photos = await commons.search('jazz')

    const [url, init] = fetch.mock.calls[0]!
    expect(new URL(String(url)).searchParams.get('gsrsearch')).toBe(
      'jazz filetype:bitmap haswbstatement:P275=Q6938433|P6216=Q19652',
    )
    expect(new Headers(init?.headers).get('user-agent')).toMatch(/PodNoms/)
    expect(photos.map((photo) => photo.id)).toEqual(['1', '2'])
    expect(photos[0]).toEqual({
      id: '1',
      downloadUrl: 'https://upload.wikimedia.test/1/1400px.jpg',
      previewUrl: 'https://upload.wikimedia.test/1/1400px.jpg',
      credit: {
        author: 'Creator 1',
        authorUrl: 'https://commons.wikimedia.org/wiki/User:U1',
        pageUrl: 'https://commons.wikimedia.org/wiki/File:1.jpg',
        source: 'Wikimedia Commons',
        sourceUrl: 'https://commons.wikimedia.org',
        preposition: 'on',
      },
    })
  })

  it("leaves out files whose licence template isn't free, and credits no one when there's no author", async () => {
    await fakeSources({ jazz: ['nc1', 'anon'] })
    const photos = await commons.search('jazz')
    expect(photos.map((photo) => photo.id)).toEqual(['anon'])
    expect(photos[0]!.credit).toMatchObject({ author: null, authorUrl: null })
  })

  it('finds nothing when nothing matches', async () => {
    await fakeSources({})
    expect(await commons.search('jazz')).toEqual([])
  })

  it('reports an error Commons sends in a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'maxlag', info: 'Waiting for a database server' } })))
    await expect(commons.search('jazz')).rejects.toThrow('Commons search failed: maxlag Waiting for a database server')
  })
})
