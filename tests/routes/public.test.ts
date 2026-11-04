// The routes anyone can fetch: episode audio, artwork, RSS feeds and short links.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as AudioRoute } from '~/routes/api/episodes/$id/audio'
import { Route as FeedRoute } from '~/routes/$user_.$show_.feed'
import { Route as ImageRoute } from '~/routes/images/$file'
import { Route as OldProfileRoute } from '~/routes/u.$'
import { getSession } from '~/server/auth.server'
import { findShortLink } from '~/server/episodes.server'
import { updateShow } from '~/server/shows.server'
import { updateProfile } from '~/server/users.server'
import { episodeAudioPath } from '~/server/storage.server'
import { resetDb } from '../db'
import { callRoute, createEpisode, createShow, createUser, db, storeTestImage } from '../helpers'

vi.mock('~/server/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/auth.server')>()),
  getSession: vi.fn(),
}))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(getSession).mockResolvedValue(null)
})

describe('GET /api/episodes/:id/audio', () => {
  // 0..99 as bytes, so any range is easy to check.
  const audio = Uint8Array.from({ length: 100 }, (_, i) => i)

  async function readyEpisode(showValues: Parameters<typeof createShow>[1] = {}, values: Parameters<typeof createEpisode>[1] = {}) {
    const owner = await createUser()
    const show = await createShow(owner.id, showValues)
    const episode = await createEpisode(show.id, { status: 'ready', audioMimeType: 'audio/mpeg', ...values })
    await mkdir(dirname(episodeAudioPath(episode.id)), { recursive: true })
    await writeFile(episodeAudioPath(episode.id), audio)
    return Object.assign(episode, { ownerId: owner.id })
  }

  const get = (id: string, range?: string, search = '') =>
    callRoute(
      AudioRoute,
      'GET',
      new Request(`http://x/api/episodes/${id}/audio${search}`, { headers: range ? { range } : {} }),
      { id },
    )

  it("serves a private show's audio with its feed key, or to its signed-in owner", async () => {
    const episode = await readyEpisode({ private: true, feedKey: 'k3y' })
    expect((await get(episode.id)).status).toBe(404)
    expect((await get(episode.id, undefined, '?key=wrong')).status).toBe(404)
    expect((await get(episode.id, undefined, '?v=2&key=k3y')).status).toBe(200)
    vi.mocked(getSession).mockResolvedValue({ user: { id: episode.ownerId }, expires: '' })
    expect((await get(episode.id)).status).toBe(200)
  })

  it("serves a private episode's audio only to its signed-in owner", async () => {
    const episode = await readyEpisode({}, { private: true })
    expect((await get(episode.id)).status).toBe(404)
    vi.mocked(getSession).mockResolvedValue({ user: { id: (await createUser()).id }, expires: '' })
    expect((await get(episode.id)).status).toBe(404)
    vi.mocked(getSession).mockResolvedValue({ user: { id: episode.ownerId }, expires: '' })
    expect((await get(episode.id)).status).toBe(200)
  })

  it('serves the whole file, advertising range support', async () => {
    const episode = await readyEpisode()
    const response = await get(episode.id)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-length')).toBe('100')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(audio)
  })

  it.each([
    ['bytes=10-19', 10, 19],
    ['bytes=90-', 90, 99],
    ['bytes=-5', 95, 99],
    ['bytes=95-500', 95, 99],
    ['bytes=-500', 0, 99],
  ])('serves %s as a partial response', async (range, start, end) => {
    const episode = await readyEpisode()
    const response = await get(episode.id, range)
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/100`)
    expect(response.headers.get('content-length')).toBe(String(end - start + 1))
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(audio.slice(start, end + 1))
  })

  it.each(['bytes=100-', 'bytes=50-40'])('refuses unsatisfiable range %s with 416', async (range) => {
    const episode = await readyEpisode()
    const response = await get(episode.id, range)
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */100')
  })

  it.each(['bytes=-', 'items=0-10', 'bytes=0-1,5-6'])('ignores unsupported range %s and serves everything', async (range) => {
    const episode = await readyEpisode()
    const response = await get(episode.id, range)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('100')
  })

  it('is 404 for episodes that are not ready, missing, or have lost their file', async () => {
    const show = await createShow((await createUser()).id)
    const pending = await createEpisode(show.id, { status: 'pending' })
    const noFile = await createEpisode(show.id, { status: 'ready' })
    expect((await get(pending.id)).status).toBe(404)
    expect((await get('missing')).status).toBe(404)
    expect((await get(noFile.id)).status).toBe(404)
  })
})

describe('GET /images/:file', () => {
  const get = (file: string, { query = '', accept = '' } = {}) =>
    callRoute(ImageRoute, 'GET', new Request(`http://x/images/${file}${query}`, { headers: { accept } }), { file })

  it('serves the original JPEG, cached for good', async () => {
    const image = await storeTestImage()
    const response = await get(`${image.imageId}.jpg`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('vary')).toBe('Accept')
    expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0)
  })

  it('serves a smaller copy as WebP when the browser accepts it', async () => {
    const image = await storeTestImage()
    const response = await get(`${image.imageId}.jpg`, { query: '?w=100', accept: 'image/avif,image/webp,*/*' })
    expect(response.headers.get('content-type')).toBe('image/webp')
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
    expect(metadata).toMatchObject({ format: 'webp', width: 128 })
  })

  it('serves a smaller JPEG to browsers without WebP', async () => {
    const image = await storeTestImage()
    const response = await get(`${image.imageId}.jpg`, { query: '?w=64', accept: 'image/jpeg' })
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({ width: 64 })
  })

  it('serves the link preview image as a 1200×630 JPEG, even to browsers with WebP', async () => {
    const image = await storeTestImage()
    const response = await get(`${image.imageId}.jpg`, { query: '?og', accept: 'image/webp' })
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
    expect(metadata).toMatchObject({ format: 'jpeg', width: 1200, height: 630 })
  })

  it('ignores invalid widths', async () => {
    const image = await storeTestImage()
    const response = await get(`${image.imageId}.jpg`, { query: '?w=abc', accept: 'image/webp' })
    expect(response.headers.get('content-type')).toBe('image/jpeg')
  })

  it.each(['missing.jpg', '../../etc/passwd', `${'0'.repeat(36)}.png`, `${crypto.randomUUID()}.jpg`])('is 404 for %s', async (file) => {
    expect((await get(file)).status).toBe(404)
  })
})

describe('GET /:user/:show/feed', () => {
  const get = (user: string, show: string, search = '') =>
    callRoute(FeedRoute, 'GET', new Request(`https://pods.example/${user}/${show}/feed${search}`), { user, show })

  it('serves the RSS feed with absolute URLs for the request origin', async () => {
    await createShow((await createUser({ slug: 'ada' })).id, { slug: 'show', title: 'Show' })
    const response = await get('ada', 'show')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    const xml = await response.text()
    expect(xml).toContain('<atom:link href="https://pods.example/ada/show/feed"')
    expect(xml).toContain('<link>https://pods.example/ada/show</link>')
  })

  it('is 404 for unknown shows, and for a show under someone else', async () => {
    await createShow((await createUser({ slug: 'ada' })).id, { slug: 'show' })
    await createUser({ slug: 'bob' })
    expect((await get('ada', 'nope')).status).toBe(404)
    expect((await get('bob', 'show')).status).toBe(404)
    expect((await get('nobody', 'show')).status).toBe(404)
  })

  it('serves two owners\' shows with the same slug apart', async () => {
    await createShow((await createUser({ slug: 'ada' })).id, { slug: 'show', title: "Ada's" })
    await createShow((await createUser({ slug: 'bob' })).id, { slug: 'show', title: "Bob's" })
    expect(await (await get('ada', 'show')).text()).toContain('<title>Ada&apos;s</title>')
    expect(await (await get('bob', 'show')).text()).toContain('<title>Bob&apos;s</title>')
  })

  it("serves a private show's feed only with its key", async () => {
    await createShow((await createUser({ slug: 'ada' })).id, { slug: 'secret', private: true, feedKey: 'k3y' })
    expect((await get('ada', 'secret')).status).toBe(404)
    expect((await get('ada', 'secret', '?key=wrong')).status).toBe(404)
    const response = await get('ada', 'secret', '?key=k3y')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<atom:link href="https://pods.example/ada/secret/feed?key=k3y"')
  })

  it('redirects for good when the owner or the show gets a new slug, keeping the key and guid', async () => {
    const user = await createUser({ slug: 'ada' })
    const show = await createShow(user.id, { slug: 'show', private: true, feedKey: 'k3y' })
    expect(await updateProfile(user.id, { name: null, slug: 'ada-l' })).toBe(true)
    let response = await get('ada', 'show', '?key=k3y')
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('/ada-l/show/feed?key=k3y')

    expect(await updateShow(user.id, { id: show.id, title: 'Show', slug: 'renamed' })).toBe(true)
    for (const [owner, slug] of [['ada', 'show'], ['ada-l', 'show'], ['ada', 'renamed']]) {
      response = await get(owner!, slug!, '?key=k3y')
      expect(response.status).toBe(301)
      expect(response.headers.get('location')).toBe('/ada-l/renamed/feed?key=k3y')
    }
    const xml = await (await get('ada-l', 'renamed', '?key=k3y')).text()
    expect(xml).toContain(`<podcast:guid>${show.podcastGuid}</podcast:guid>`)
    // The key is still checked at the new address.
    expect((await get('ada-l', 'renamed')).status).toBe(404)
  })
})

describe('GET /u/*', () => {
  it('sends old profile and playlist addresses to where they are now, for good', async () => {
    for (const [splat, location] of [['ada', '/ada'], ['ada/playlists/mix', '/ada/playlists/mix']] as const) {
      const response = await callRoute(OldProfileRoute, 'GET', new Request(`https://pods.example/u/${splat}?x=1`), { _splat: splat })
      expect(response.status).toBe(301)
      expect(response.headers.get('location')).toBe(`${location}?x=1`)
    }
  })
})

describe('share pages', () => {
  it("find a published episode by its short slug", async () => {
    const show = await createShow((await createUser()).id, { slug: 'my-show' })
    const episode = await createEpisode(show.id, { slug: 'first', status: 'ready', audioUrl: '/api/episodes/x/audio' })
    expect(await findShortLink(episode.shortSlug)).toEqual({ showId: show.id, episodeSlug: 'first' })
  })

  it("find nothing for an episode that isn't ready, or doesn't exist", async () => {
    const show = await createShow((await createUser()).id)
    const episode = await createEpisode(show.id, { status: 'processing' })
    expect(await findShortLink(episode.shortSlug)).toBeNull()
    expect(await findShortLink('nosuchep')).toBeNull()
  })
})
