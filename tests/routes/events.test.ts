// The episode event stream pages listen to while episodes are processed.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as EventsRoute } from '~/routes/api/podcasts/$slug/events'
import { getSession } from '~/server/auth.server'
import { resetDb } from '../db'
import { callRoute, createPodcast, createUser, db } from '../helpers'

vi.mock('~/server/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/auth.server')>()),
  getSession: vi.fn(),
}))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(getSession).mockResolvedValue(null)
})

const get = (slug: string, signal?: AbortSignal) =>
  callRoute(EventsRoute, 'GET', new Request(`http://x/api/podcasts/${slug}/events`, { signal }), { slug })

describe('GET /api/podcasts/:slug/events', () => {
  it('is 401 when signed out', async () => {
    expect((await get('show')).status).toBe(401)
  })

  it("is 404 for someone else's podcast", async () => {
    await createPodcast((await createUser()).id, { slug: 'theirs' })
    vi.mocked(getSession).mockResolvedValue({ user: { id: (await createUser()).id }, expires: '' })
    expect((await get('theirs')).status).toBe(404)
  })

  it("streams events to the podcast's owner", async () => {
    const user = await createUser()
    await createPodcast(user.id, { slug: 'mine' })
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id }, expires: '' })
    const abort = new AbortController()

    const response = await get('mine', abort.signal)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform')
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('retry: 3000\n\n')
    abort.abort()
    expect((await reader.read()).done).toBe(true)
  })
})
