import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { listeningEvents, users } from '~/server/db/schema'
import {
  getKeepListeningHistory,
  listeningHistoryFor,
  pruneListeningHistory,
  recordListening,
  setKeepListeningHistory,
} from '~/server/listening-history.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const day = (n: number, hour = 12) => new Date(Date.UTC(2026, 10, n, hour))

async function setUp() {
  const owner = await createUser({ slug: 'owner' })
  const show = await createShow(owner.id, { title: 'The Show', slug: 'the-show' })
  const episode = await createEpisode(show.id, { title: 'One', slug: 'one', status: 'ready' })
  const listener = await createUser()
  return { show, episode, listener }
}

describe('listening history', () => {
  it('counts each episode and kind once a day', async () => {
    const { episode, listener } = await setUp()
    expect(await recordListening(listener.id, { episodeId: episode.id, type: 'play', source: 'web' }, day(1, 9))).toBe(true)
    expect(await recordListening(listener.id, { episodeId: episode.id, type: 'play', source: 'app' }, day(1, 20))).toBe(false)
    expect(await recordListening(listener.id, { episodeId: episode.id, type: 'download', source: 'app' }, day(1))).toBe(true)
    expect(await recordListening(listener.id, { episodeId: episode.id, type: 'play', source: 'web' }, day(2))).toBe(true)
    expect(await db.select().from(listeningEvents)).toHaveLength(3)
  })

  it('sums it up for admins, newest first, with where each episode is', async () => {
    const { episode, listener } = await setUp()
    const now = day(25)
    await recordListening(listener.id, { episodeId: episode.id, type: 'play', source: 'web' }, day(1))
    await recordListening(listener.id, { episodeId: episode.id, type: 'play', source: 'web' }, day(20))
    await recordListening(listener.id, { episodeId: episode.id, type: 'share', source: 'listen', detail: 'embed' }, day(21))
    // A month and more before.
    await recordListening(listener.id, { episodeId: episode.id, type: 'download', source: 'app' }, new Date(Date.UTC(2026, 8, 1)))

    const history = await listeningHistoryFor(listener.id, { now })
    expect(history).toMatchObject({
      keep: true,
      play: { count: 2, lastMonth: 2, lastAt: day(20) },
      download: { count: 1, lastMonth: 0 },
      share: { count: 1, lastMonth: 1, lastAt: day(21) },
    })
    expect(history.recent.map((event) => event.type)).toEqual(['share', 'play', 'play', 'download'])
    expect(history.recent[0]).toMatchObject({
      episodeTitle: 'One',
      episodeSlug: 'one',
      showTitle: 'The Show',
      ownerSlug: 'owner',
      slug: 'the-show',
      detail: 'embed',
    })
  })

  it('stops and deletes it when turned off, and starts again when turned on', async () => {
    const { episode, listener } = await setUp()
    const other = await createUser()
    await recordListening(listener.id, { episodeId: episode.id, type: 'play', source: 'web' })
    await recordListening(other.id, { episodeId: episode.id, type: 'play', source: 'web' })

    await setKeepListeningHistory(listener.id, false)
    expect(await getKeepListeningHistory(listener.id)).toBe(false)
    const rows = await db.select().from(listeningEvents)
    expect(rows.map((row) => row.userId)).toEqual([other.id])
    expect(await recordListening(listener.id, { episodeId: episode.id, type: 'download', source: 'app' })).toBe(false)
    expect((await listeningHistoryFor(listener.id)).keep).toBe(false)

    await setKeepListeningHistory(listener.id, true)
    expect(await recordListening(listener.id, { episodeId: episode.id, type: 'download', source: 'app' })).toBe(true)
  })

  it('keeps it for a year', async () => {
    const { episode, listener } = await setUp()
    const now = new Date(Date.UTC(2027, 10, 27))
    await recordListening(listener.id, { episodeId: episode.id, type: 'play', source: 'web' }, new Date(Date.UTC(2026, 10, 1)))
    await recordListening(listener.id, { episodeId: episode.id, type: 'play', source: 'web' }, new Date(Date.UTC(2027, 1, 1)))
    expect(await pruneListeningHistory(now)).toBe(1)
    expect(await db.select().from(listeningEvents)).toHaveLength(1)
  })

  it('goes with the user', async () => {
    const { episode, listener } = await setUp()
    await recordListening(listener.id, { episodeId: episode.id, type: 'play', source: 'web' })
    await db.delete(users).where(eq(users.id, listener.id))
    expect(await db.select().from(listeningEvents)).toEqual([])
  })
})
