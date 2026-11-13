import { beforeEach, describe, expect, it } from 'vitest'
import { listAdminShows } from '~/server/admin-shows.server'
import { channelItems, channels, liveBroadcasts } from '~/server/db/schema'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const at = (minute: number) => new Date(Date.UTC(2026, 10, 5, 0, minute))

describe('the admin list of shows', () => {
  it('counts a show\'s episodes by how they were added', async () => {
    const user = await createUser({ email: 'a@example.com', name: 'Ann', slug: 'ann' })
    const show = await createShow(user.id, { title: 'Mixed', slug: 'mixed' })
    const [channel] = await db
      .insert(channels)
      .values({ showId: show.id, platform: 'youtube', url: 'https://www.youtube.com/@x/videos' })
      .returning()

    await createEpisode(show.id, { durationSeconds: 3600, createdAt: at(15) })
    await createEpisode(show.id, { durationSeconds: 1800, createdAt: at(31) })
    await createEpisode(show.id, { sourceUrl: 'https://www.youtube.com/watch?v=a', durationSeconds: 60, createdAt: at(40) })
    await createEpisode(show.id, { sourceUrl: 'https://youtu.be/b', createdAt: at(41) })
    await createEpisode(show.id, { sourceUrl: 'https://WWW.YouTube.com/watch?v=c', createdAt: at(42) })
    const fromChannel = await createEpisode(show.id, { sourceUrl: 'https://www.youtube.com/watch?v=d', durationSeconds: 120 })
    await db.insert(channelItems).values({ channelId: channel!.id, sourceKey: 'youtube:d', episodeId: fromChannel.id })
    // Seen on the channel but never made into an episode, or since deleted.
    await db.insert(channelItems).values({ channelId: channel!.id, sourceKey: 'youtube:e' })
    const recording = await createEpisode(show.id, { durationSeconds: 600 })
    await db.insert(liveBroadcasts).values({ showId: show.id, title: 'Live', episodeId: recording.id })

    const [listed, ...others] = await listAdminShows()
    expect(others).toEqual([])
    expect(listed).toMatchObject({
      id: show.id,
      title: 'Mixed',
      slug: 'mixed',
      ownerSlug: 'ann',
      owner: { name: 'Ann', email: 'a@example.com' },
      channel: { kind: 'channel', platform: 'youtube', url: 'https://www.youtube.com/@x/videos' },
      episodes: 7,
      seconds: 3600 + 1800 + 60 + 120 + 600,
    })
    const sources = listed!.sources.map(({ origin, host, episodes, seconds }) => ({ origin, host, episodes, seconds }))
    expect(sources).toHaveLength(5)
    expect(sources).toEqual(
      expect.arrayContaining([
        { origin: 'upload', host: null, episodes: 2, seconds: 5400 },
        { origin: 'link', host: 'youtube.com', episodes: 2, seconds: 60 },
        { origin: 'link', host: 'youtu.be', episodes: 1, seconds: 0 },
        { origin: 'channel', host: null, episodes: 1, seconds: 120 },
        { origin: 'live', host: null, episodes: 1, seconds: 600 },
      ]),
    )
    // The biggest source comes first.
    expect(sources[0]!.episodes).toBe(2)
    const uploads = listed!.sources.find((source) => source.origin === 'upload')!
    expect(uploads.firstAddedAt).toEqual(at(15))
    expect(uploads.lastAddedAt).toEqual(at(31))
  })

  it('lists every show, the ones added to most recently first and empty ones last', async () => {
    const user = await createUser()
    const empty = await createShow(user.id, { title: 'Empty' })
    const older = await createShow(user.id, { title: 'Older', private: true })
    const newer = await createShow(user.id, { title: 'Newer' })
    await createEpisode(older.id, { createdAt: at(1) })
    await createEpisode(newer.id, { createdAt: at(2) })

    const listed = await listAdminShows()
    expect(listed.map((show) => show.title)).toEqual(['Newer', 'Older', 'Empty'])
    expect(listed.map((show) => show.private)).toEqual([false, true, false])
    expect(listed.find((show) => show.id === empty.id)).toMatchObject({
      episodes: 0,
      seconds: 0,
      lastAddedAt: null,
      channel: null,
      sources: [],
    })
    expect(listed[0]!.lastAddedAt).toEqual(at(2))
  })
})
