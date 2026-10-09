import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { podcasts } from '~/server/db/schema'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// Loads the module afresh with the given environment, as src/env.ts reads it once.
async function load(keys?: { key: string; secret: string }) {
  vi.resetModules()
  if (keys) {
    vi.stubEnv('PODCASTINDEX_API_KEY', keys.key)
    vi.stubEnv('PODCASTINDEX_API_SECRET', keys.secret)
  }
  return import('~/server/directories.server')
}

// A podcast directories would list: described, with artwork, a category and an episode.
async function readyPodcast(userId: string, values: Parameters<typeof createPodcast>[1] = {}) {
  const podcast = await createPodcast(userId, {
    slug: 'show',
    description: '<p>About</p>',
    imageUrl: '/images/a.jpg',
    category: 'Music',
    ...values,
  })
  await createEpisode(podcast.id, { status: 'ready', audioUrl: '/api/episodes/x/audio' })
  return podcast
}

describe('getDirectoryReadiness', () => {
  it("checks the user's podcast, counting only published episodes", async () => {
    const { getDirectoryReadiness } = await load()
    const user = await createUser({ name: 'Ada' })
    const podcast = await createPodcast(user.id, { imageUrl: '/images/a.jpg' })
    await createEpisode(podcast.id, { status: 'pending' })
    const failing = (await getDirectoryReadiness(user.id, podcast.id))!.filter((item) => !item.ok).map((item) => item.id)
    expect(failing).toEqual(['description', 'category', 'episode', 'ownerEmail'])
  })

  it("is null for someone else's podcast", async () => {
    const { getDirectoryReadiness } = await load()
    const podcast = await createPodcast((await createUser()).id)
    expect(await getDirectoryReadiness((await createUser()).id, podcast.id)).toBeNull()
  })
})

describe('submitToPodcastIndex', () => {
  it('refuses when no key is configured', async () => {
    const { submitToPodcastIndex, podcastIndexConfigured } = await load()
    const user = await createUser({ name: 'Ada' })
    const podcast = await readyPodcast(user.id)
    expect(podcastIndexConfigured()).toBe(false)
    expect(await submitToPodcastIndex(user.id, podcast.id, 'https://pods.example')).toMatchObject({ ok: false })
  })

  it("refuses a podcast that isn't ready", async () => {
    const { submitToPodcastIndex } = await load({ key: 'k', secret: 's' })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const user = await createUser({ name: 'Ada' })
    const podcast = await readyPodcast(user.id, { category: null })
    expect(await submitToPodcastIndex(user.id, podcast.id, 'https://pods.example')).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('submits the feed with a signed request and remembers the listing', async () => {
    const { submitToPodcastIndex } = await load({ key: 'KEY', secret: 'SECRET' })
    const fetch = vi.fn(async () => Response.json({ status: 'true', feedId: 920666, description: 'Feed added' }))
    vi.stubGlobal('fetch', fetch)
    const user = await createUser({ name: 'Ada' })
    const podcast = await readyPodcast(user.id)

    const result = await submitToPodcastIndex(user.id, podcast.id, 'https://pods.example')
    expect(result).toEqual({ ok: true, link: 'https://podcastindex.org/podcast/920666' })

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(
      `https://api.podcastindex.org/api/1.0/add/byfeedurl?url=${encodeURIComponent('https://pods.example/feed/show')}`,
    )
    const headers = init.headers as Record<string, string>
    expect(init.method).toBe('POST')
    expect(headers['X-Auth-Key']).toBe('KEY')
    expect(headers.Authorization).toBe(
      createHash('sha1').update(`KEYSECRET${headers['X-Auth-Date']}`).digest('hex'),
    )

    const [row] = await db.select().from(podcasts).where(eq(podcasts.id, podcast.id))
    expect(row!.directoryLinks).toEqual({ podcastIndex: 'https://podcastindex.org/podcast/920666' })
  })

  it('reports a refusal without saving a link', async () => {
    const { submitToPodcastIndex } = await load({ key: 'KEY', secret: 'SECRET' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'false', description: 'Nope' }, { status: 400 })))
    const user = await createUser({ name: 'Ada' })
    const podcast = await readyPodcast(user.id)
    expect(await submitToPodcastIndex(user.id, podcast.id, 'https://pods.example')).toMatchObject({ ok: false })
    const [row] = await db.select().from(podcasts).where(eq(podcasts.id, podcast.id))
    expect(row!.directoryLinks).toEqual({})
  })
})
