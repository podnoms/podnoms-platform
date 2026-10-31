// The routes MediaMTX and live pages use: MediaMTX's authentication hook,
// the HLS proxy and the live event stream.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as AuthRoute } from '~/routes/api/live/auth'
import { Route as EventsRoute } from '~/routes/api/shows/$slug/live/events'
import { Route as HlsRoute } from '~/routes/api/shows/$slug/live/hls/$'
import { getSession } from '~/server/auth.server'
import { liveBroadcasts } from '~/server/db/schema'
import { createLiveKey } from '~/server/live.server'
import { resetDb } from '../db'
import { callRoute, createShow, createUser, db } from '../helpers'

vi.mock('~/server/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/auth.server')>()),
  getSession: vi.fn(),
}))

const secret = process.env.LIVE_SECRET!

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(getSession).mockResolvedValue(null)
})
afterEach(() => vi.restoreAllMocks())

const signIn = (userId: string) => vi.mocked(getSession).mockResolvedValue({ user: { id: userId }, expires: '' })
// Slugs are unique per test, as who may watch which show is remembered for a moment.
const slug = () => `show-${crypto.randomUUID().slice(0, 8)}`

describe('POST /api/live/auth', () => {
  const post = (token: string | null, body: unknown) =>
    callRoute(
      AuthRoute,
      'POST',
      new Request(`http://app/api/live/auth${token === null ? '' : `?token=${token}`}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )

  it('lets MediaMTX check a stream key', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    const { streamKey } = (await createLiveKey(user.id, show.id))!
    const [, query] = streamKey.split('?')
    const publish = { action: 'publish', path: `live/${show.id}`, protocol: 'rtmp', query }

    expect((await post(secret, publish)).status).toBe(200)
    expect((await post(secret, { ...publish, query: 'key=wrong' })).status).toBe(401)
    expect((await post(secret, 'not json')).status).toBe(401)
  })

  it("refuses anyone who doesn't have LIVE_SECRET", async () => {
    expect((await post(null, { action: 'read', user: 'podnoms', password: secret })).status).toBe(401)
    expect((await post('wrong', { action: 'read', user: 'podnoms', password: secret })).status).toBe(401)
  })
})

describe('GET /api/shows/:slug/live/hls/*', () => {
  const get = (showSlug: string, file: string, search = '') =>
    callRoute(HlsRoute, 'GET', new Request(`http://x/api/shows/${showSlug}/live/hls/${file}${search}`), {
      slug: showSlug,
      _splat: file,
    })

  it('passes on the stream from MediaMTX, reading it as the app', async () => {
    const show = await createShow((await createUser()).id, { slug: slug() })
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('#EXTM3U\n', { headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }))

    const response = await get(show.slug, 'index.m3u8', '?_HLS_msn=3&_HLS_part=1')

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('#EXTM3U\n')
    expect(response.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe(`http://mediamtx.test:8888/live/${show.id}/index.m3u8?_HLS_msn=3&_HLS_part=1`)
    expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${btoa(`podnoms:${secret}`)}`)
  })

  it('lets private caches keep segments', async () => {
    const show = await createShow((await createUser()).id, { slug: slug() })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('data'))
    expect((await get(show.slug, 'seg1_part0.mp4')).headers.get('cache-control')).toBe('private, max-age=3600')
  })

  it('is 404 while the show is not live', async () => {
    const show = await createShow((await createUser()).id, { slug: slug() })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('not found', { status: 404 }))
    expect((await get(show.slug, 'index.m3u8')).status).toBe(404)
  })

  it('is 502 when MediaMTX is down', async () => {
    const show = await createShow((await createUser()).id, { slug: slug() })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    expect((await get(show.slug, 'index.m3u8')).status).toBe(502)
  })

  it("only shows a private show's stream to its owner", async () => {
    const owner = await createUser()
    const show = await createShow(owner.id, { slug: slug(), private: true })
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('#EXTM3U\n'))

    expect((await get(show.slug, 'index.m3u8')).status).toBe(404)
    signIn((await createUser()).id)
    expect((await get(show.slug, 'index.m3u8')).status).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
    signIn(owner.id)
    expect((await get(show.slug, 'index.m3u8')).status).toBe(200)
  })

  it("won't fetch anything but a plain file name", async () => {
    const show = await createShow((await createUser()).id, { slug: slug() })
    const fetch = vi.spyOn(globalThis, 'fetch')
    for (const file of ['../other/index.m3u8', '..', 'a/b.m3u8', '.hidden', '']) {
      expect((await get(show.slug, file)).status).toBe(404)
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('GET /api/shows/:slug/live/events', () => {
  const get = (showSlug: string, signal?: AbortSignal, search = '?watching=1') =>
    callRoute(EventsRoute, 'GET', new Request(`http://x/api/shows/${showSlug}/live/events${search}`, { signal }), {
      slug: showSlug,
    })

  it("is 404 for a private show that isn't the viewer's", async () => {
    const show = await createShow((await createUser()).id, { slug: slug(), private: true })
    expect((await get(show.slug)).status).toBe(404)
  })

  it('streams what is on and how many are watching, to anyone', async () => {
    const show = await createShow((await createUser()).id, { slug: slug() })
    const [broadcast] = await db.insert(liveBroadcasts).values({ showId: show.id, title: 'On air' }).returning()
    const abort = new AbortController()

    const response = await get(show.slug, abort.signal)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    const reader = response.body!.getReader()
    let text = ''
    while (!text.includes('event: status')) text += new TextDecoder().decode((await reader.read()).value)
    abort.abort()

    expect(text).toContain('retry: 3000\n\n')
    expect(text).toContain('event: viewers\ndata: {"count":1}\n\n')
    expect(text).toContain(`"id":"${broadcast!.id}"`)
    expect(text).toContain('"title":"On air"')
  })

  it("doesn't count the show's own page as watching", async () => {
    const show = await createShow((await createUser()).id, { slug: slug() })
    await db.insert(liveBroadcasts).values({ showId: show.id, title: 'On air' })
    const abort = new AbortController()

    const reader = (await get(show.slug, abort.signal, '')).body!.getReader()
    let text = ''
    while (!text.includes('event: status')) text += new TextDecoder().decode((await reader.read()).value)
    abort.abort()

    expect(text).toContain('event: viewers\ndata: {"count":0}\n\n')
  })
})
