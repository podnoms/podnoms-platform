import { beforeEach, describe, expect, it } from 'vitest'
import { getDashboard } from '~/server/dashboard.server'
import { episodeActivity } from '~/server/db/schema'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

beforeEach(async () => {
  await resetDb(db)
})

const now = new Date('2026-10-03T12:00:00Z')

async function insert(rows: Partial<typeof episodeActivity.$inferInsert>[], episodeId: string, podcastId: string) {
  await db.insert(episodeActivity).values(
    rows.map((row, i) => ({
      episodeId,
      podcastId,
      type: 'play' as const,
      source: 'web' as const,
      visitorHash: `${episodeId}-${i}`,
      occurredAt: now,
      ...row,
    })),
  )
}

describe('getDashboard', () => {
  it('counts podcasts and episodes, and totals activity across them', async () => {
    const user = await createUser()
    const first = await createPodcast(user.id, { title: 'First' })
    const second = await createPodcast(user.id, { title: 'Second', imageUrl: '/images/a.jpg' })
    const popular = await createEpisode(first.id, { title: 'Popular', status: 'ready', durationSeconds: 600 })
    const quiet = await createEpisode(second.id, { title: 'Quiet', status: 'ready', durationSeconds: 300 })
    await createEpisode(second.id, { title: 'Broken', status: 'failed' })
    await createEpisode(second.id, { title: 'Busy', status: 'processing' })
    await insert(
      [
        { country: 'IE' },
        { country: 'GB' },
        { type: 'download', source: 'app', country: 'IE' },
        { type: 'share', detail: 'link', country: 'FR' },
      ],
      popular.id,
      first.id,
    )
    await insert([{}], quiet.id, second.id)
    // In the previous 7 days, to compare against.
    await insert([{ occurredAt: new Date('2026-09-25T12:00:00Z'), visitorHash: 'old' }], quiet.id, second.id)

    // Someone else's podcast isn't counted.
    const otherPodcast = await createPodcast((await createUser()).id)
    const otherEpisode = await createEpisode(otherPodcast.id, { status: 'ready' })
    await insert([{}], otherEpisode.id, otherPodcast.id)

    const dashboard = await getDashboard(user.id, 7, now)
    expect(dashboard.podcasts).toBe(2)
    expect(dashboard.episodes).toEqual({ total: 4, inProgress: 1, failed: 1, totalSeconds: 900 })
    expect(dashboard.activity.totals).toEqual({ play: 3, download: 1, share: 1 })
    expect(dashboard.previousTotals).toEqual({ play: 1, download: 0, share: 0 })
    expect(dashboard.topEpisodes).toEqual([
      expect.objectContaining({ title: 'Popular', podcastTitle: 'First', plays: 2, downloads: 1, imageUrl: null }),
      expect.objectContaining({ title: 'Quiet', podcastTitle: 'Second', plays: 1, downloads: 0, imageUrl: '/images/a.jpg' }),
    ])
    // Shares and unknown locations aren't on the map.
    expect(dashboard.countries).toEqual([
      { country: 'IE', plays: 1, downloads: 1 },
      { country: 'GB', plays: 1, downloads: 0 },
    ])
    expect(dashboard.recentEpisodes.map((episode) => episode.title).sort()).toEqual(['Broken', 'Busy', 'Popular', 'Quiet'])
  })

  it('is all zeros for a user with nothing', async () => {
    const user = await createUser()
    const dashboard = await getDashboard(user.id, 30, now)
    expect(dashboard.podcasts).toBe(0)
    expect(dashboard.episodes).toEqual({ total: 0, inProgress: 0, failed: 0, totalSeconds: 0 })
    expect(dashboard.activity.totals).toEqual({ play: 0, download: 0, share: 0 })
    expect(dashboard.topEpisodes).toEqual([])
    expect(dashboard.countries).toEqual([])
    expect(dashboard.recentEpisodes).toEqual([])
  })
})
