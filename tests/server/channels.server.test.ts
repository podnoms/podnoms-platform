import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { channelItems, channels, episodes, podcasts } from '~/server/db/schema'
import {
  checkChannel,
  checkChannelNow,
  checkDueChannels,
  createChannelPodcast,
  followChannel,
  getPodcastChannel,
  setChannelEnabled,
} from '~/server/channels.server'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { resetDb } from '../db'
import { createUser, db, makeImage } from '../helpers'

// What's queued is checked; the downloads themselves are tested elsewhere.
vi.mock('~/server/episode-processor.server', () => ({ enqueueEpisode: vi.fn() }))

const media = process.env.MEDIA_DIR!
let server: Server
let thumbnailUrl: string

beforeAll(async () => {
  const png = await makeImage(64, 64)
  server = createServer((_request, response) => response.end(png))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  thumbnailUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/avatar.png`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

beforeEach(async () => {
  vi.mocked(enqueueEpisode).mockClear()
  await resetDb(db)
})

// A channel as the fake yt-dlp lists it (see tests/fixtures/fake-yt-dlp.mjs).
function channelUrl(params: Record<string, string>) {
  return `https://video.test/channel?${new URLSearchParams(params)}`
}

// Follows the channel, and waits for its first check.
async function follow(params: Record<string, string>, userValues: Parameters<typeof createUser>[0] = {}) {
  const user = await createUser(userValues)
  const podcast = await followChannel(user.id, { platform: 'youtube', url: channelUrl(params) })
  const [channel] = await db.select().from(channels).where(eq(channels.podcastId, podcast.id))
  await checkChannel(channel!.id)
  return { user, podcast, channel: (await getChannel(channel!.id))! }
}

async function getChannel(id: string) {
  const [channel] = await db.select().from(channels).where(eq(channels.id, id))
  return channel
}

const episodesOf = (podcastId: string) =>
  db.select().from(episodes).where(eq(episodes.podcastId, podcastId)).orderBy(asc(episodes.createdAt))

async function setEntries(channelId: string, params: Record<string, string>) {
  await db.update(channels).set({ url: channelUrl(params) }).where(eq(channels.id, channelId))
}

describe('following a channel', () => {
  it("queues the newest uploads, up to the user's limit, oldest first", async () => {
    const { podcast, channel } = await follow({ entries: 'e,d,c,b,a', title: 'My Channel' }, { channelEpisodeLimit: 3 })

    const rows = await episodesOf(podcast.id)
    expect(rows.map((e) => e.title)).toEqual(['Video c', 'Video d', 'Video e'])
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'pending', priority: 0, slug: row.title.toLowerCase().replace(' ', '-') })
      expect(row.sourceUrl).toMatch(/^https:\/\/video\.test\/watch\?/)
    }
    expect(vi.mocked(enqueueEpisode).mock.calls.map(([id]) => id)).toEqual(rows.map((e) => e.id))
    expect(channel).toMatchObject({ title: 'My Channel', lastError: null })
    expect(channel.lastCheckedAt).toBeInstanceOf(Date)
    expect(channel.nextCheckAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60 * 60_000)

    // Only as many as the limit are asked for, politely.
    const args = JSON.parse(await readFile(join(media, 'yt-dlp-args.json'), 'utf8')) as string[]
    expect(args).toEqual(expect.arrayContaining(['--flat-playlist', '--lazy-playlist', '--sleep-requests']))
    expect(args[args.indexOf('--playlist-end') + 1]).toBe('3')
  })

  it("names the podcast after the channel, with its description and artwork", async () => {
    const { podcast } = await follow({ entries: 'a', title: 'My Channel', description: 'All about it', thumbnail: thumbnailUrl })
    const [row] = await db.select().from(podcasts).where(eq(podcasts.id, podcast.id))
    expect(row).toMatchObject({ title: 'My Channel', description: '<p>All about it</p>' })
    expect(row!.imageUrl).toMatch(/^\/images\/[0-9a-f-]{36}\.jpg$/)
  })

  it("keeps a title the user gave the podcast before the channel's was known", async () => {
    const user = await createUser()
    const podcast = await followChannel(user.id, { platform: 'youtube', url: channelUrl({ entries: 'a', title: 'Theirs' }) })
    await db.update(podcasts).set({ title: 'Mine' }).where(eq(podcasts.id, podcast.id))
    const [channel] = await db.select().from(channels).where(eq(channels.podcastId, podcast.id))
    await checkChannel(channel!.id)
    const [row] = await db.select().from(podcasts).where(eq(podcasts.id, podcast.id))
    expect(row!.title).toBe('Mine')
  })

  it('skips live streams and Shorts', async () => {
    const { podcast } = await follow({ entries: 'c,b,a', live: 'c', short: 'b' })
    expect((await episodesOf(podcast.id)).map((e) => e.title)).toEqual(['Video a'])
  })

  it('notes why the channel could not be listed, and adds nothing', async () => {
    const user = await createUser()
    const podcast = await followChannel(user.id, { platform: 'youtube', url: 'https://video.test/fail' })
    const [channel] = await db.select().from(channels).where(eq(channels.podcastId, podcast.id))
    expect(await checkChannel(channel!.id)).toEqual({ error: 'This video is unavailable' })
    expect(await getChannel(channel!.id)).toMatchObject({ lastError: 'This video is unavailable' })
    expect((await getChannel(channel!.id))!.lastCheckedAt).toBeInstanceOf(Date)
    expect(await episodesOf(podcast.id)).toEqual([])
  })

  it("doesn't list the channel for a user whose limit is 0", async () => {
    const { podcast, channel } = await follow({ entries: 'a' }, { channelEpisodeLimit: 0 })
    expect(channel.lastError).toMatch(/can't import/)
    expect(await episodesOf(podcast.id)).toEqual([])
  })

  it('only accepts links to channels', async () => {
    const user = await createUser()
    await expect(createChannelPodcast(user.id, { url: 'https://www.youtube.com/watch?v=abc' })).rejects.toThrow()
    expect(await db.select().from(podcasts)).toEqual([])
  })

  it("starts from the link's name, until the channel's own is known", async () => {
    const user = await createUser()
    const podcast = await createChannelPodcast(user.id, { url: 'https://www.youtube.com/@someone' })
    expect(podcast.title).toBe('@someone')
    const [channel] = await db.select().from(channels).where(eq(channels.podcastId, podcast.id))
    expect(channel).toMatchObject({ platform: 'youtube', url: 'https://www.youtube.com/@someone/videos' })
    await checkChannel(channel!.id)
  })
})

describe('checking a channel again', () => {
  it('adds only uploads newer than those seen', async () => {
    const { podcast, channel } = await follow({ entries: 'c,b,a' })
    await setEntries(channel.id, { entries: 'e,d,c,b,a' })
    vi.mocked(enqueueEpisode).mockClear()
    expect(await checkChannel(channel.id)).toEqual({ added: 2 })
    expect((await episodesOf(podcast.id)).map((e) => e.title)).toEqual(['Video a', 'Video b', 'Video c', 'Video d', 'Video e'])
    expect(enqueueEpisode).toHaveBeenCalledTimes(2)
  })

  it("doesn't add an older upload that comes into view", async () => {
    const { podcast, channel } = await follow({ entries: 'd,c' }, { channelEpisodeLimit: 2 })
    // d was taken down, so b, which was never listed, now is.
    await setEntries(channel.id, { entries: 'e,c,b' })
    expect(await checkChannel(channel.id)).toEqual({ added: 1 })
    expect((await episodesOf(podcast.id)).map((e) => e.title)).toEqual(['Video c', 'Video d', 'Video e'])
  })

  it("doesn't bring back an episode the user deleted", async () => {
    const { podcast, channel } = await follow({ entries: 'b,a' })
    const [first] = await episodesOf(podcast.id)
    await db.delete(episodes).where(eq(episodes.id, first!.id))
    expect(await checkChannel(channel.id)).toEqual({ added: 0 })
    expect((await episodesOf(podcast.id)).map((e) => e.title)).toEqual(['Video b'])
    const items = await db.select().from(channelItems).where(eq(channelItems.channelId, channel.id))
    expect(items).toHaveLength(2)
  })

  it('checks a channel once at a time', async () => {
    const { channel } = await follow({ entries: 'a' })
    await setEntries(channel.id, { entries: 'b,a' })
    const [one, two] = await Promise.all([checkChannel(channel.id), checkChannel(channel.id)])
    expect(one).toEqual({ added: 1 })
    expect(two).toBe(one)
  })
})

describe('checkDueChannels', () => {
  it('checks enabled channels that are due', async () => {
    const due = await follow({ entries: 'a' })
    const notDue = await follow({ entries: 'a' })
    const paused = await follow({ entries: 'a' })
    for (const { channel } of [due, notDue, paused]) await setEntries(channel.id, { entries: 'b,a' })
    await db.update(channels).set({ nextCheckAt: new Date(Date.now() - 1000) }).where(eq(channels.id, due.channel.id))
    await db
      .update(channels)
      .set({ nextCheckAt: new Date(Date.now() - 1000), enabled: false })
      .where(eq(channels.id, paused.channel.id))

    expect(await checkDueChannels()).toEqual({ checked: 1, added: 1, failed: 0 })
    expect(await episodesOf(due.podcast.id)).toHaveLength(2)
    expect(await episodesOf(notDue.podcast.id)).toHaveLength(1)
    expect(await episodesOf(paused.podcast.id)).toHaveLength(1)
  })
})

describe("the user's controls", () => {
  it('checks now, but not again within a few minutes', async () => {
    const { user, podcast, channel } = await follow({ entries: 'a' })
    expect(await checkChannelNow(user.id, podcast.id)).toBe('too-soon')

    await db.update(channels).set({ lastCheckedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(channels.id, channel.id))
    await setEntries(channel.id, { entries: 'b,a' })
    expect(await checkChannelNow(user.id, podcast.id)).toBe('started')
    await checkChannel(channel.id)
    expect(await episodesOf(podcast.id)).toHaveLength(2)
  })

  it('pauses and resumes checking', async () => {
    const { user, podcast, channel } = await follow({ entries: 'a' })
    expect(await setChannelEnabled(user.id, podcast.id, false)).toBe(true)
    expect(await getPodcastChannel(podcast.id)).toMatchObject({ enabled: false, checking: false })
    expect(await setChannelEnabled(user.id, podcast.id, true)).toBe(true)
    expect((await getChannel(channel.id))!.nextCheckAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it("leaves other users' channels alone", async () => {
    const { podcast } = await follow({ entries: 'a' })
    const someoneElse = await createUser()
    expect(await checkChannelNow(someoneElse.id, podcast.id)).toBeNull()
    expect(await setChannelEnabled(someoneElse.id, podcast.id, false)).toBe(false)
  })
})
