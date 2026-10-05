import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { listChannel, mixcloudApi } from '~/server/channel-listing.server'
import { RateLimitedError } from '~/server/download-throttle.server'

// Stands in for Mixcloud's API, answering as `answer` says and noting each request.
let server: Server
let requests: string[] = []
let answer: (path: string) => { status: number; body?: unknown }

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push(request.url!)
    const { status, body } = answer(request.url!)
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body ?? {}))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  mixcloudApi.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  mixcloudApi.pauseMs = 0
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
beforeEach(() => {
  requests = []
})

const cloudcast = (slug: string, seconds = 3600) => ({
  key: `/someone/${slug}/`,
  url: `https://www.mixcloud.com/someone/${slug}/`,
  name: `Mix ${slug}`,
  audio_length: seconds,
})

describe('listing a Mixcloud user', () => {
  beforeEach(() => {
    answer = (path) =>
      path.startsWith('/someone/cloudcasts/')
        ? { status: 200, body: { data: [cloudcast('b'), cloudcast('a', 30)] } }
        : path === '/someone/'
          ? { status: 200, body: { name: 'Someone', biog: 'Mixes.', pictures: { large: 'https://img/l.jpg', '640wx640h': 'https://img/640.jpg' } } }
          : { status: 404 }
  })

  it("asks Mixcloud's API for just the newest uploads, and the user's details", async () => {
    const listing = await listChannel('mixcloud', 'https://www.mixcloud.com/someone/uploads/', 5)
    expect(requests).toEqual(['/someone/cloudcasts/?limit=5', '/someone/'])
    expect(listing).toEqual({
      title: 'Someone',
      description: 'Mixes.',
      thumbnail: 'https://img/640.jpg',
      entries: [
        { key: 'mixcloud:/someone/b/', url: 'https://www.mixcloud.com/someone/b/', title: 'Mix b', durationSeconds: 3600, live: false },
        { key: 'mixcloud:/someone/a/', url: 'https://www.mixcloud.com/someone/a/', title: 'Mix a', durationSeconds: 30, live: false },
      ],
    })
  })

  it("skips the user's details when they aren't wanted", async () => {
    const listing = await listChannel('mixcloud', 'https://www.mixcloud.com/someone/uploads/', 5, { details: false })
    expect(requests).toEqual(['/someone/cloudcasts/?limit=5'])
    expect(listing.title).toBeNull()
    expect(listing.entries).toHaveLength(2)
  })

  it("says when there's no such user", async () => {
    await expect(listChannel('mixcloud', 'https://www.mixcloud.com/nobody/uploads/', 5)).rejects.toThrow(
      "Couldn't find that Mixcloud user",
    )
  })

  it('takes "too many requests" as Mixcloud refusing us', async () => {
    answer = () => ({ status: 429 })
    await expect(listChannel('mixcloud', 'https://www.mixcloud.com/someone/uploads/', 5)).rejects.toBeInstanceOf(
      RateLimitedError,
    )
  })
})

describe('listing with yt-dlp', () => {
  it('takes the channel from the tab name, and the avatar as its artwork', async () => {
    const url = `https://video.test/channel?${new URLSearchParams({ entries: 'b,a', title: 'Someone', thumbnail: 'https://img/avatar.jpg', live: 'b' })}`
    const listing = await listChannel('youtube', url, 10)
    expect(listing.title).toBe('Someone')
    expect(listing.thumbnail).toBe('https://img/avatar.jpg')
    expect(listing.entries.map(({ key, live }) => ({ key, live }))).toEqual([
      { key: 'youtube:b', live: true },
      { key: 'youtube:a', live: false },
    ])
  })

  it("takes yt-dlp's refusal errors as the platform refusing us", async () => {
    await expect(listChannel('youtube', 'https://video.test/rate-limited', 10)).rejects.toBeInstanceOf(RateLimitedError)
  })
})
