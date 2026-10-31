// The browser extension's API, which lists the user's shows and adds
// episodes from links found on a page.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as EpisodesRoute } from '~/routes/api/extension/episodes'
import { Route as ShowsRoute } from '~/routes/api/extension/shows'
import { getSession } from '~/server/auth.server'
import { subscribeToEpisodeEvents, type EpisodeEvent } from '~/server/episode-events.server'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { saveLinkArtwork } from '~/server/link-details.server'
import { episodes } from '~/server/db/schema'
import { eq } from 'drizzle-orm'
import { resetDb } from '../db'
import { callRoute, createShow, createUser, db } from '../helpers'

vi.mock('~/server/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/auth.server')>()),
  getSession: vi.fn(),
}))
vi.mock('~/server/episode-processor.server', () => ({ enqueueEpisode: vi.fn() }))
vi.mock('~/server/link-details.server', () => ({ saveLinkArtwork: vi.fn() }))

const signedInAs = (id: string) => vi.mocked(getSession).mockResolvedValue({ user: { id }, expires: '' })

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(getSession).mockResolvedValue(null)
  vi.mocked(enqueueEpisode).mockClear()
})

function postEpisode(body: unknown, contentType = 'application/json') {
  return callRoute(
    EpisodesRoute,
    'POST',
    new Request('http://x/api/extension/episodes', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': contentType },
    }),
  )
}

describe('GET /api/extension/shows', () => {
  it('is 401 when signed out', async () => {
    const response = await callRoute(ShowsRoute, 'GET', new Request('http://x/api/extension/shows'))
    expect(response.status).toBe(401)
  })

  it("lists only the user's shows, with full URLs", async () => {
    const user = await createUser()
    const other = await createUser()
    await createShow(user.id, { title: 'Mine', slug: 'mine', imageUrl: '/images/a.jpg' })
    await createShow(other.id, { title: 'Theirs', slug: 'theirs' })
    signedInAs(user.id)

    const response = await callRoute(ShowsRoute, 'GET', new Request('http://x/api/extension/shows'))
    expect(await response.json()).toEqual([
      { id: expect.any(String), slug: 'mine', title: 'Mine', imageUrl: 'http://x/images/a.jpg', url: 'http://x/mine' },
    ])
  })
})

describe('POST /api/extension/episodes', () => {
  it('is 401 when signed out', async () => {
    expect((await postEpisode({ showId: 'x', sourceUrl: 'https://youtu.be/abc' })).status).toBe(401)
  })

  it('only takes JSON, so other sites cannot post a form with the cookie', async () => {
    const user = await createUser()
    signedInAs(user.id)
    expect((await postEpisode({}, 'text/plain')).status).toBe(415)
  })

  it('adds a link episode to the show and queues it', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    signedInAs(user.id)

    const response = await postEpisode({ showId: show.id, sourceUrl: 'https://youtu.be/abc', title: 'From a page' })
    expect(response.status).toBe(201)
    const episode = (await response.json()) as { id: string; slug: string }
    expect(episode.slug).toBe('from-a-page')
    expect(enqueueEpisode).toHaveBeenCalledWith(episode.id)
  })

  it("keeps a file's details from the page, and tries its image as the artwork", async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    signedInAs(user.id)

    const sourceUrl = 'https://podnoms.test/api/episodes/42/audio'
    const response = await postEpisode({
      showId: show.id,
      sourceUrl,
      title: 'Eine Kleine Nachtnoodle',
      description: 'Late night boogie.',
      imageUrl: 'https://podnoms.test/images/art.jpg?og',
    })
    expect(response.status).toBe(201)
    const { id } = (await response.json()) as { id: string }
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, id))
    expect(episode).toMatchObject({ title: 'Eine Kleine Nachtnoodle', description: expect.stringContaining('Late night boogie.') })
    expect(saveLinkArtwork).toHaveBeenCalledWith(id, sourceUrl, ['https://podnoms.test/images/art.jpg?og'])
  })

  it('refuses an image that is not a web link', async () => {
    signedInAs((await createUser()).id)
    const response = await postEpisode({ showId: 'x', sourceUrl: 'https://youtu.be/abc', imageUrl: 'file:///etc/passwd' })
    expect(response.status).toBe(400)
  })

  it('tells open show pages about the new episode', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    signedInAs(user.id)
    const seen: EpisodeEvent[] = []
    const unsubscribe = subscribeToEpisodeEvents((event) => seen.push(event))

    const response = await postEpisode({ showId: show.id, sourceUrl: 'https://youtu.be/abc' })
    unsubscribe()
    const episode = (await response.json()) as { id: string }
    expect(seen).toContainEqual({ type: 'changed', episodeId: episode.id })
  })

  it("is 404 for someone else's show", async () => {
    const owner = await createUser()
    const show = await createShow(owner.id)
    signedInAs((await createUser()).id)
    expect((await postEpisode({ showId: show.id, sourceUrl: 'https://youtu.be/abc' })).status).toBe(404)
  })

  it('explains a bad link', async () => {
    signedInAs((await createUser()).id)
    const response = await postEpisode({ showId: 'x', sourceUrl: 'not a link' })
    expect(response.status).toBe(400)
  })
})
