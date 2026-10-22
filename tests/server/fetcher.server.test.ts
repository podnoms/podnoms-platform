import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { listChannel } from '~/server/channel-listing.server'
import { FetcherUnavailableError, RateLimitedError } from '~/server/download-throttle.server'
import { fetcherConfig, fetcherHealth, remoteDownload } from '~/server/fetcher.server'
import { exists, hasFfmpeg, makeTone } from '../helpers'
import { startFakeFetcher } from '../fixtures/fake-fetcher'

const media = process.env.MEDIA_DIR!
const secret = 'fake-fetcher-secret-0123456789'
let fetcher: Awaited<ReturnType<typeof startFakeFetcher>>

beforeAll(async () => {
  fetcher = await startFakeFetcher(secret)
})
afterAll(() => fetcher.close())

function useFetcher(url = fetcher.url, key = secret) {
  fetcherConfig.url = url
  fetcherConfig.secret = key
}
afterEach(() => {
  fetcherConfig.url = null
  fetcherConfig.secret = null
})

describe.skipIf(!hasFfmpeg)('downloading through the fetcher', () => {
  beforeAll(async () => {
    process.env.FAKE_YTDLP_AUDIO = await makeTone(join(media, 'fixture.mp3'), 1)
  })

  it('passes on its lines, copies the download here, and deletes it there', async () => {
    useFetcher()
    const lines: string[] = []
    const path = await remoteDownload('https://video.test/watch?title=Hi', join(media, 'one.download.%(ext)s'), (line) => lines.push(line))
    expect(path).toBe(join(media, 'one.download.mp3'))
    expect(await readFile(path)).toEqual(await readFile(process.env.FAKE_YTDLP_AUDIO!))
    expect(lines.filter((line) => line.startsWith('PROGRESS '))).toHaveLength(3)
    expect(lines.some((line) => line.startsWith('DETAILS ') && line.includes('"Hi"'))).toBe(true)
    expect(fetcher.files.size).toBe(0)
    expect(fetcher.deleted).toHaveLength(1)
  })

  it("gives the platform's refusal as a RateLimitedError", async () => {
    useFetcher()
    const download = remoteDownload('https://video.test/rate-limited', join(media, 'two.download.%(ext)s'), () => {})
    await expect(download).rejects.toBeInstanceOf(RateLimitedError)
    await expect(download).rejects.not.toBeInstanceOf(FetcherUnavailableError)
  })

  it('gives other failures as they are', async () => {
    useFetcher()
    await expect(remoteDownload('https://video.test/fail', join(media, 'three.download.%(ext)s'), () => {})).rejects.toThrow(
      'This video is unavailable',
    )
  })

  it('counts a dropped connection as the fetcher being unavailable, leaving nothing behind', async () => {
    useFetcher()
    const download = remoteDownload('https://video.test/hang-up', join(media, 'four.download.%(ext)s'), () => {})
    await expect(download).rejects.toBeInstanceOf(FetcherUnavailableError)
    expect(await exists(join(media, 'four.download.mp3'))).toBe(false)
  })
})

describe('when the fetcher is unavailable', () => {
  it("says so when it can't be reached", async () => {
    useFetcher('http://127.0.0.1:9')
    await expect(remoteDownload('https://video.test/watch', join(media, 'x.%(ext)s'), () => {})).rejects.toBeInstanceOf(
      FetcherUnavailableError,
    )
    expect(await fetcherHealth()).toMatchObject({ reachable: false })
  })

  it('says so when it turns us away', async () => {
    useFetcher(fetcher.url, 'the-wrong-secret-0123456789')
    await expect(listChannel('youtube', 'https://video.test/channel?entries=a', 5)).rejects.toBeInstanceOf(FetcherUnavailableError)
  })
})

describe('listing through the fetcher', () => {
  it('lists the channel as yt-dlp would here', async () => {
    useFetcher()
    const listing = await listChannel('youtube', 'https://video.test/channel?entries=c,b,a&title=Someone', 2)
    expect(listing.title).toBe('Someone')
    expect(listing.entries.map((entry) => entry.key)).toEqual(['youtube:c', 'youtube:b'])
  })

  it("gives the platform's refusal as a RateLimitedError", async () => {
    useFetcher()
    await expect(listChannel('youtube', 'https://video.test/rate-limited', 5)).rejects.toBeInstanceOf(RateLimitedError)
  })
})

describe('fetcherHealth', () => {
  it('is null without a fetcher', async () => {
    expect(await fetcherHealth()).toBeNull()
  })

  it("reports the fetcher's yt-dlp and public IP", async () => {
    useFetcher()
    expect(await fetcherHealth()).toEqual({ reachable: true, ytDlpVersion: 'fake', publicIp: '10.0.0.9' })
  })
})
