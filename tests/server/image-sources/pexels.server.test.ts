import { afterEach, describe, expect, it, vi } from 'vitest'
import { pexels } from '~/server/image-sources/pexels.server'
import { fakeSources } from '../../fake-image-sources'

afterEach(() => vi.unstubAllGlobals())

describe('pexels', () => {
  it('searches with the key, and downloads photos cropped square', async () => {
    const fetch = await fakeSources({ jazz: [11] })
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
      preposition: 'on',
    })
  })
})
