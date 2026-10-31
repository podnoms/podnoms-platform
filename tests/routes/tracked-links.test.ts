// Share pages reporting opens and plays of tracked links.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as TrackedLinkRoute } from '~/routes/api/tracked-links/$token'
import { getSession } from '~/server/auth.server'
import { trackedLinks } from '~/server/db/schema'
import { createTrackedLink, listTrackedLinks } from '~/server/tracked-links.server'
import { resetDb } from '../db'
import { callRoute, createEpisode, createShow, createUser, db } from '../helpers'

vi.mock('~/server/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/auth.server')>()),
  getSession: vi.fn(),
}))

const chrome =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(getSession).mockResolvedValue(null)
})

const post = (token: string, body: unknown) =>
  callRoute(
    TrackedLinkRoute,
    'POST',
    new Request(`http://x/api/tracked-links/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': chrome },
      body: JSON.stringify(body),
    }),
    { token },
  )

describe('POST /api/tracked-links/:token', () => {
  it('counts an open, answering the same for unknown tokens', async () => {
    const owner = await createUser()
    const episode = await createEpisode((await createShow(owner.id)).id, { status: 'ready' })
    await createTrackedLink(owner.id, episode.id, 'Alex')
    const [{ token }] = (await db.select({ token: trackedLinks.token }).from(trackedLinks)) as [{ token: string }]

    expect((await post(token, { type: 'open', episodeId: episode.id })).status).toBe(204)
    expect((await post('unknown', { type: 'open', episodeId: episode.id })).status).toBe(204)
    expect(await listTrackedLinks(owner.id, episode.id)).toMatchObject([{ openCount: 1 }])
  })

  it("doesn't count the owner opening their own link", async () => {
    const owner = await createUser()
    const episode = await createEpisode((await createShow(owner.id)).id, { status: 'ready' })
    await createTrackedLink(owner.id, episode.id, 'Alex')
    const [{ token }] = (await db.select({ token: trackedLinks.token }).from(trackedLinks)) as [{ token: string }]
    vi.mocked(getSession).mockResolvedValue({ user: { id: owner.id }, expires: '' })

    await post(token, { type: 'open', episodeId: episode.id })
    expect(await listTrackedLinks(owner.id, episode.id)).toMatchObject([{ openCount: 0 }])
  })

  it('rejects an invalid report', async () => {
    expect((await post('x', { type: 'download', episodeId: 'e' })).status).toBe(400)
  })
})
