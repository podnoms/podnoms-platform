import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { episodes } from '~/server/db/schema'
import { stagedImagePath } from '~/server/storage.server'
import { RateLimitedError, resetThrottle, withDownloadSlot } from '~/server/download-throttle.server'
import { subscribeToEpisodeEvents, type EpisodeEvent } from '~/server/episode-events.server'
import { linkDetailSources, lookUpLink, saveLinkArtwork, youtubeVideoId } from '~/server/link-details.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db, exists, makeImage } from '../helpers'

// Stands in for YouTube's oEmbed and image CDN, SoundCloud's oEmbed and Mixcloud's API.
let server: Server
let base: string
const requests: string[] = []
// Paths answered with an image; anything else is a 404.
let images = new Set<string>()

beforeAll(async () => {
  const png = await makeImage(64, 64)
  server = createServer((request, response) => {
    const url = new URL(request.url!, base)
    requests.push(url.pathname + url.search)
    if (url.pathname === '/oembed') {
      response.setHeader('Content-Type', 'application/json')
      const youtube = url.searchParams.get('url')!.includes('youtube.com')
      return response.end(
        JSON.stringify(
          youtube
            ? { title: 'Never Gonna', author_name: 'Rick', thumbnail_url: `${base}/hq.jpg` }
            : { title: 'Track by Artist', author_name: 'Artist', description: 'About&nbsp;<a href="https://x.test">it</a>', thumbnail_url: `${base}/sc.png` },
        ),
      )
    }
    if (url.pathname === '/dj/show/') {
      response.setHeader('Content-Type', 'application/json')
      return response.end(
        JSON.stringify({ name: 'The Show', description: 'A mix', pictures: { large: `${base}/small.png`, '1024wx1024h': `${base}/mc.png` } }),
      )
    }
    if (images.has(url.pathname)) return response.end(png)
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  Object.assign(linkDetailSources, { youtube: base, youtubeImages: base, soundcloud: base, mixcloudApi: base })
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
beforeEach(async () => {
  requests.length = 0
  images = new Set(['/vi/dQw4w9WgXcQ/maxresdefault.jpg', '/sc.png', '/mc.png'])
  await resetDb(db)
})
afterEach(() => resetThrottle())

async function linkEpisode(sourceUrl: string, values: Parameters<typeof createEpisode>[1] = {}) {
  const user = await createUser()
  const show = await createShow(user.id)
  return createEpisode(show.id, { sourceUrl, title: sourceUrl, status: 'pending', ...values })
}

async function imageOf(id: string) {
  const [row] = await db.select({ imageUrl: episodes.imageUrl }).from(episodes).where(eq(episodes.id, id))
  return row!.imageUrl
}

describe('youtubeVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=x', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/@channel', null],
    ['https://www.youtube.com/watch?v=short', null],
    ['not a link', null],
  ])('%s → %s', (url, id) => {
    expect(youtubeVideoId(url)).toBe(id)
  })
})

describe('saveLinkArtwork', () => {
  it("saves a YouTube video's thumbnail from the image CDN, and says it's changed", async () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    const episode = await linkEpisode(url)
    const events: EpisodeEvent[] = []
    const unsubscribe = subscribeToEpisodeEvents((event) => events.push(event))
    await saveLinkArtwork(episode.id, url)
    unsubscribe()
    expect(await imageOf(episode.id)).toMatch(/^\/images\/[0-9a-f-]{36}\.jpg$/)
    expect(requests).toEqual(['/vi/dQw4w9WgXcQ/maxresdefault.jpg'])
    expect(events).toContainEqual({ type: 'changed', episodeId: episode.id })
  })

  it('falls back to smaller YouTube thumbnails', async () => {
    images = new Set(['/vi/dQw4w9WgXcQ/hqdefault.jpg'])
    const url = 'https://youtu.be/dQw4w9WgXcQ'
    const episode = await linkEpisode(url)
    await saveLinkArtwork(episode.id, url)
    expect(await imageOf(episode.id)).toMatch(/^\/images\//)
    expect(requests).toEqual(['maxresdefault', 'sddefault', 'hqdefault'].map((name) => `/vi/dQw4w9WgXcQ/${name}.jpg`))
  })

  it("uses SoundCloud's oEmbed thumbnail", async () => {
    const url = 'https://soundcloud.com/artist/track'
    const episode = await linkEpisode(url)
    await saveLinkArtwork(episode.id, url)
    expect(await imageOf(episode.id)).toMatch(/^\/images\//)
    expect(requests).toEqual([`/oembed?${new URLSearchParams({ format: 'json', url })}`, '/sc.png'])
  })

  it("uses the Mixcloud show's largest picture", async () => {
    const url = 'https://www.mixcloud.com/dj/show/'
    const episode = await linkEpisode(url)
    await saveLinkArtwork(episode.id, url)
    expect(await imageOf(episode.id)).toMatch(/^\/images\//)
    expect(requests).toEqual(['/dj/show/', '/mc.png'])
  })

  it('leaves an image the episode already has', async () => {
    const url = 'https://youtu.be/dQw4w9WgXcQ'
    const episode = await linkEpisode(url, { imageUrl: '/images/mine.jpg' })
    await saveLinkArtwork(episode.id, url)
    expect(await imageOf(episode.id)).toBe('/images/mine.jpg')
  })

  it('does nothing for other sites, or when there is no image', async () => {
    images = new Set()
    for (const url of ['https://video.test/watch', 'https://youtu.be/dQw4w9WgXcQ']) {
      const episode = await linkEpisode(url)
      await saveLinkArtwork(episode.id, url)
      expect(await imageOf(episode.id)).toBeNull()
    }
  })

  it("falls back to the page's image, after the platform's own", async () => {
    images = new Set(['/page.png'])
    const file = 'https://cdn.test/episodes/42/audio'
    const episode = await linkEpisode(file)
    await saveLinkArtwork(episode.id, file, [`${base}/page.png`])
    expect(await imageOf(episode.id)).toMatch(/^\/images\//)
    expect(requests).toEqual(['/page.png'])

    requests.length = 0
    images = new Set(['/sc.png', '/page.png'])
    const track = 'https://soundcloud.com/artist/track'
    const other = await linkEpisode(track)
    await saveLinkArtwork(other.id, track, [`${base}/page.png`])
    expect(requests).not.toContain('/page.png')
  })

  it('sends nothing to a platform that is refusing us', async () => {
    await withDownloadSlot('youtube', { key: 'x' }, async () => {
      throw new RateLimitedError('slow down')
    }).catch(() => {})
    const url = 'https://youtu.be/dQw4w9WgXcQ'
    const episode = await linkEpisode(url)
    await saveLinkArtwork(episode.id, url)
    expect(requests).toEqual([])
    expect(await imageOf(episode.id)).toBeNull()
  })
})

describe('lookUpLink', () => {
  it("gives a YouTube video's title from oEmbed and stages its thumbnail", async () => {
    const user = await createUser()
    const details = await lookUpLink(user.id, 'https://youtu.be/dQw4w9WgXcQ')
    expect(details).toMatchObject({
      title: 'Never Gonna',
      description: null,
      image: { previewUrl: `${base}/vi/dQw4w9WgXcQ/maxresdefault.jpg` },
    })
    expect(await exists(stagedImagePath(user.id, details.image!.imageId))).toBe(true)
  })

  it("gives a SoundCloud track's title without the byline, and its description as text", async () => {
    const user = await createUser()
    expect(await lookUpLink(user.id, 'https://soundcloud.com/artist/track')).toMatchObject({
      title: 'Track',
      description: 'About it',
      image: { previewUrl: `${base}/sc.png` },
    })
  })

  it("gives a Mixcloud show's name, description and picture", async () => {
    const user = await createUser()
    expect(await lookUpLink(user.id, 'https://www.mixcloud.com/dj/show/')).toMatchObject({
      title: 'The Show',
      description: 'A mix',
      image: { previewUrl: `${base}/mc.png` },
    })
  })

  it('gives nothing for other sites', async () => {
    const user = await createUser()
    expect(await lookUpLink(user.id, 'https://video.test/watch')).toEqual({ title: null, description: null, image: null })
    expect(requests).toEqual([])
  })
})
