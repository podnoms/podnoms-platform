import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveBroadcasts, podcasts } from '~/server/db/schema'
import { subscribeToLiveEvents, type LiveEvent } from '~/server/live-events.server'
import { finishRecording } from '~/server/live-recordings.server'
import {
  addChatMessage,
  authorizeLive,
  ChatTooFastError,
  createLiveKey,
  deleteChatMessage,
  endBroadcast,
  getLiveSettings,
  getOpenBroadcast,
  getWatchablePodcast,
  listChat,
  liveTokenFrom,
  reconnectGraceMs,
  revokeLiveKey,
  setLiveTitle,
  syncLiveBroadcasts,
} from '~/server/live.server'
import { resetDb } from '../db'
import { createPodcast, createUser, db } from '../helpers'

vi.mock('~/server/live-recordings.server', () => ({ finishRecording: vi.fn() }))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(finishRecording).mockReset().mockResolvedValue(null)
})
afterEach(() => vi.restoreAllMocks())

// MediaMTX's API, listing these paths.
function mediamtx(paths: { name: string; ready: boolean }[]) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ pageCount: 1, itemCount: paths.length, items: paths }))
}

const live = (podcastId: string) => ({ name: `live/${podcastId}`, ready: true })

function recordEvents() {
  const events: LiveEvent[] = []
  const unsubscribe = subscribeToLiveEvents((event) => events.push(event))
  return { events, unsubscribe }
}

async function openBroadcast(podcastId: string, values: Partial<typeof liveBroadcasts.$inferInsert> = {}) {
  const [broadcast] = await db
    .insert(liveBroadcasts)
    .values({ podcastId, title: 'On air', ...values })
    .returning()
  return broadcast!
}

const keyOf = (streamKey: string) => new URLSearchParams(streamKey.split('?')[1]).get('key')!

describe('live keys', () => {
  it('gives the owner a stream key, kept encrypted, which they can see again', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id)

    const created = await createLiveKey(user.id, podcast.id)

    expect(created!.server).toBe('rtmp://live.example.com/live')
    expect(created!.streamKey).toMatch(new RegExp(`^${podcast.id}\\?key=[\\w-]{32}$`))
    const [row] = await db.select({ liveKey: podcasts.liveKey }).from(podcasts).where(eq(podcasts.id, podcast.id))
    expect(row!.liveKey).not.toContain(keyOf(created!.streamKey))
    expect((await getLiveSettings(user.id, podcast.id))!.streamKey).toBe(created!.streamKey)

    await revokeLiveKey(user.id, podcast.id)
    expect((await getLiveSettings(user.id, podcast.id))!.streamKey).toBeNull()
  })

  it("treats a key that can't be decrypted (AUTH_SECRET changed) as none", async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { liveKey: 'not.an.encrypted-key' })
    expect((await getLiveSettings(user.id, podcast.id))!.streamKey).toBeNull()
    expect(await authorizeLive({ action: 'publish', path: `live/${podcast.id}`, query: 'key=anything' })).toBe(false)
  })

  it("won't make or revoke a key for someone else's podcast", async () => {
    const podcast = await createPodcast((await createUser()).id)
    const other = await createUser()
    expect(await createLiveKey(other.id, podcast.id)).toBeNull()
    expect(await revokeLiveKey(other.id, podcast.id)).toBe(false)
    expect(await getLiveSettings(other.id, podcast.id)).toBeNull()
  })
})

describe('authorizeLive', () => {
  const publish = (podcastId: string, key: string | null) => ({
    action: 'publish',
    path: `live/${podcastId}`,
    protocol: 'rtmp',
    query: key === null ? '' : `key=${encodeURIComponent(key)}`,
  })

  it("lets a stream publish with its podcast's key, and nothing else", async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id)
    const other = await createPodcast(user.id)
    const key = keyOf((await createLiveKey(user.id, podcast.id))!.streamKey)
    await createLiveKey(user.id, other.id)

    expect(await authorizeLive(publish(podcast.id, key))).toBe(true)
    expect(await authorizeLive(publish(podcast.id, `${key}x`))).toBe(false)
    expect(await authorizeLive(publish(podcast.id, null))).toBe(false)
    // Another podcast's path with this podcast's key.
    expect(await authorizeLive(publish(other.id, key))).toBe(false)
    expect(await authorizeLive({ ...publish(podcast.id, key), path: `other/${podcast.id}` })).toBe(false)
  })

  it('stops a key working once it is replaced or revoked', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id)
    const first = keyOf((await createLiveKey(user.id, podcast.id))!.streamKey)
    const second = keyOf((await createLiveKey(user.id, podcast.id))!.streamKey)

    expect(await authorizeLive(publish(podcast.id, first))).toBe(false)
    expect(await authorizeLive(publish(podcast.id, second))).toBe(true)
    await revokeLiveKey(user.id, podcast.id)
    expect(await authorizeLive(publish(podcast.id, second))).toBe(false)
  })

  it('refuses publishing to a podcast without a key', async () => {
    const podcast = await createPodcast((await createUser()).id)
    expect(await authorizeLive(publish(podcast.id, 'anything'))).toBe(false)
  })

  it('only lets the app read streams and use the API', async () => {
    const read = { action: 'read', path: `live/${crypto.randomUUID()}`, protocol: 'hls' }
    expect(await authorizeLive({ ...read, user: 'podnoms', password: process.env.LIVE_SECRET })).toBe(true)
    expect(await authorizeLive({ ...read, user: 'podnoms', password: 'wrong' })).toBe(false)
    expect(await authorizeLive({ ...read, user: 'someone', password: process.env.LIVE_SECRET })).toBe(false)
    expect(await authorizeLive(read)).toBe(false)
    expect(await authorizeLive({ action: 'api', user: 'podnoms', password: process.env.LIVE_SECRET })).toBe(true)
    expect(await authorizeLive({ action: 'api', user: 'podnoms', password: 'wrong' })).toBe(false)
    expect(await authorizeLive({ action: 'api' })).toBe(false)
    expect(await authorizeLive({ action: 'metrics', user: 'podnoms', password: process.env.LIVE_SECRET })).toBe(false)
  })
})

describe('syncLiveBroadcasts', () => {
  it("opens a broadcast when a podcast's stream appears, titled as the owner chose", async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: 'The Show', liveTitle: 'Q&A night' })
    const plain = await createPodcast(user.id, { title: 'Other Show' })
    mediamtx([live(podcast.id), live(plain.id), { name: 'live/not-a-podcast', ready: true }, { name: `live/${crypto.randomUUID()}`, ready: true }])
    const { events, unsubscribe } = recordEvents()

    await syncLiveBroadcasts(new Date('2026-10-12T20:00:00Z'))
    unsubscribe()

    const open = await db.select().from(liveBroadcasts)
    expect(open.map((b) => [b.podcastId, b.title, b.endedAt]).sort()).toEqual(
      [
        [podcast.id, 'Q&A night', null],
        [plain.id, 'Other Show live, 12 October 2026', null],
      ].sort(),
    )
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'status', podcastId: podcast.id },
        { type: 'status', podcastId: plain.id },
      ]),
    )
  })

  it('ignores paths that are not ready yet', async () => {
    const podcast = await createPodcast((await createUser()).id)
    mediamtx([{ name: `live/${podcast.id}`, ready: false }])
    await syncLiveBroadcasts()
    expect(await db.select().from(liveBroadcasts)).toEqual([])
  })

  it('keeps a broadcast open through a short drop-out, then ends it and makes its recording an episode', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const start = new Date('2026-10-12T20:00:00Z')
    const at = (ms: number) => new Date(start.getTime() + ms)
    const fetch = mediamtx([live(podcast.id)])
    await syncLiveBroadcasts(start)
    const [broadcast] = await db.select().from(liveBroadcasts)

    // Gone, but within the grace period: still open.
    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [] }))
    await syncLiveBroadcasts(at(reconnectGraceMs - 1000))
    // Back again: the same broadcast carries on.
    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [live(podcast.id)] }))
    await syncLiveBroadcasts(at(reconnectGraceMs))
    expect(await db.select({ id: liveBroadcasts.id, endedAt: liveBroadcasts.endedAt }).from(liveBroadcasts)).toEqual([
      { id: broadcast!.id, endedAt: null },
    ])
    expect(finishRecording).not.toHaveBeenCalled()

    // Gone for longer than the grace period: it ended when last seen.
    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [] }))
    const { events, unsubscribe } = recordEvents()
    await syncLiveBroadcasts(at(2 * reconnectGraceMs + 1000))
    unsubscribe()

    const [ended] = await db.select().from(liveBroadcasts)
    expect(ended!.endedAt).toEqual(at(reconnectGraceMs))
    expect(events).toEqual([{ type: 'status', podcastId: podcast.id }])
    expect(finishRecording).toHaveBeenCalledWith(expect.objectContaining({ id: broadcast!.id }))
  })

  it('marks a broadcast interrupted as soon as its stream goes, telling viewers, and clears it when it comes back', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const start = new Date('2026-10-12T20:00:00Z')
    const fetch = mediamtx([live(podcast.id)])
    await syncLiveBroadcasts(start)

    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [] }))
    let { events, unsubscribe } = recordEvents()
    await syncLiveBroadcasts(new Date(start.getTime() + 5000))
    // Not again on the next poll.
    await syncLiveBroadcasts(new Date(start.getTime() + 10_000))
    unsubscribe()
    expect(events).toEqual([{ type: 'status', podcastId: podcast.id }])
    expect((await getOpenBroadcast(podcast.id))!.interruptedAt).toEqual(new Date(start.getTime() + 5000))

    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [live(podcast.id)] }))
    ;({ events, unsubscribe } = recordEvents())
    await syncLiveBroadcasts(new Date(start.getTime() + 15_000))
    unsubscribe()
    expect(events).toEqual([{ type: 'status', podcastId: podcast.id }])
    expect((await getOpenBroadcast(podcast.id))!.interruptedAt).toBeNull()
  })

  it("changes nothing when MediaMTX can't be reached", async () => {
    const podcast = await createPodcast((await createUser()).id)
    await openBroadcast(podcast.id, { lastSeenAt: new Date(Date.now() - 10 * reconnectGraceMs) })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))

    await expect(syncLiveBroadcasts()).rejects.toThrow('fetch failed')
    expect((await db.select().from(liveBroadcasts))[0]!.endedAt).toBeNull()
  })

  it('calls the API as the app, which MediaMTX checks with /api/live/auth', async () => {
    const fetch = mediamtx([])
    await syncLiveBroadcasts()
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toMatch(/^http:\/\/mediamtx\.test:9997\/v3\/paths\/list/)
    expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${btoa(`podnoms:${process.env.LIVE_SECRET}`)}`)
  })

  it('reads every page of paths', async () => {
    const podcast = await createPodcast((await createUser()).id)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get('page'))
      return Response.json({ pageCount: 2, items: page === 1 ? [live(podcast.id)] : [] })
    })
    await syncLiveBroadcasts()
    expect(await db.select({ podcastId: liveBroadcasts.podcastId }).from(liveBroadcasts)).toEqual([{ podcastId: podcast.id }])
  })
})

describe('endBroadcast', () => {
  it('lets the owner end an interrupted broadcast at once, telling viewers and making the episode', async () => {
    const owner = await createUser()
    const podcast = await createPodcast(owner.id)
    const lastSeenAt = new Date(Date.now() - 20_000)
    const broadcast = await openBroadcast(podcast.id, { lastSeenAt, interruptedAt: new Date(Date.now() - 15_000) })
    const { events, unsubscribe } = recordEvents()

    expect(await endBroadcast(owner.id, broadcast.id)).toBe(true)
    unsubscribe()

    const [ended] = await db.select().from(liveBroadcasts)
    expect(ended).toMatchObject({ endedAt: lastSeenAt, interruptedAt: null })
    expect(events).toEqual([{ type: 'status', podcastId: podcast.id }])
    expect(finishRecording).toHaveBeenCalledWith(expect.objectContaining({ id: broadcast.id }))
    expect(await getOpenBroadcast(podcast.id)).toBeNull()
    // Once only, even if the poller gets there too.
    expect(await endBroadcast(owner.id, broadcast.id)).toBe(false)
    expect(finishRecording).toHaveBeenCalledTimes(1)
  })

  it("won't end someone else's broadcast, or one whose stream is still coming in", async () => {
    const owner = await createUser()
    const podcast = await createPodcast(owner.id)
    const streaming = await openBroadcast(podcast.id)
    expect(await endBroadcast(owner.id, streaming.id)).toBe(false)

    await db.update(liveBroadcasts).set({ interruptedAt: new Date() }).where(eq(liveBroadcasts.id, streaming.id))
    expect(await endBroadcast((await createUser()).id, streaming.id)).toBe(false)
    expect(await getOpenBroadcast(podcast.id)).not.toBeNull()
    expect(finishRecording).not.toHaveBeenCalled()
  })
})

describe('setLiveTitle', () => {
  it("renames the broadcast that's on now, and the next", async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id)
    await openBroadcast(podcast.id)

    expect(await setLiveTitle(user.id, podcast.id, '  Late show ')).toBe(true)

    expect((await db.select().from(liveBroadcasts))[0]!.title).toBe('Late show')
    expect((await getLiveSettings(user.id, podcast.id))!.liveTitle).toBe('Late show')
    expect(await setLiveTitle(user.id, podcast.id, '')).toBe(true)
    expect((await getLiveSettings(user.id, podcast.id))!.liveTitle).toBeNull()
    expect(await setLiveTitle((await createUser()).id, podcast.id, 'Mine now')).toBe(false)
  })
})

describe('chat', () => {
  it('lets signed-in viewers chat while live, for everyone watching to see', async () => {
    const owner = await createUser({ name: 'Host' })
    const podcast = await createPodcast(owner.id)
    const broadcast = await openBroadcast(podcast.id)
    const viewer = await createUser({ name: 'Listener' })
    const { events, unsubscribe } = recordEvents()

    const message = await addChatMessage(viewer.id, broadcast.id, '  Hello!  ')
    unsubscribe()

    expect(message).toMatchObject({ body: 'Hello!', author: { name: 'Listener' }, canDelete: true })
    expect(message).not.toHaveProperty('userId')
    expect(events).toEqual([
      { type: 'message', podcastId: podcast.id, message: expect.objectContaining({ body: 'Hello!', userId: viewer.id }) },
    ])
    const owners = await listChat(podcast, broadcast.id, owner.id)
    const anyone = await listChat(podcast, broadcast.id, null)
    expect(owners.map((m) => [m.body, m.canDelete])).toEqual([['Hello!', true]])
    expect(anyone.map((m) => [m.body, m.canDelete])).toEqual([['Hello!', false]])
  })

  it('only lists a broadcast with the podcast it belongs to', async () => {
    const user = await createUser()
    const secret = await createPodcast(user.id, { private: true })
    const open = await createPodcast(user.id)
    const broadcast = await openBroadcast(secret.id)
    await addChatMessage(user.id, broadcast.id, 'Private chat')
    expect(await listChat(open, broadcast.id, null)).toEqual([])
  })

  it("refuses messages once the broadcast has ended, and to those who can't see a private podcast", async () => {
    const owner = await createUser()
    const secret = await createPodcast(owner.id, { private: true })
    const broadcast = await openBroadcast(secret.id)
    const stranger = await createUser()

    expect(await addChatMessage(stranger.id, broadcast.id, 'Hi')).toBeNull()
    expect(await addChatMessage(owner.id, broadcast.id, 'Hi')).not.toBeNull()

    await db.update(liveBroadcasts).set({ endedAt: new Date() }).where(eq(liveBroadcasts.id, broadcast.id))
    expect(await addChatMessage(owner.id, broadcast.id, 'Still there?')).toBeNull()
  })

  it('slows down someone writing too fast', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const broadcast = await openBroadcast(podcast.id)
    const viewer = await createUser()

    await addChatMessage(viewer.id, broadcast.id, 'one')
    await expect(addChatMessage(viewer.id, broadcast.id, 'two')).rejects.toBeInstanceOf(ChatTooFastError)
    // Others aren't held up.
    expect(await addChatMessage((await createUser()).id, broadcast.id, 'three')).not.toBeNull()
  })

  it('lets the writer or the podcast owner delete a message', async () => {
    const owner = await createUser()
    const podcast = await createPodcast(owner.id)
    const broadcast = await openBroadcast(podcast.id)
    const writer = await createUser()
    const stranger = await createUser()
    const first = (await addChatMessage(writer.id, broadcast.id, 'first'))!
    const second = (await addChatMessage((await createUser()).id, broadcast.id, 'second'))!
    const { events, unsubscribe } = recordEvents()

    expect(await deleteChatMessage(stranger.id, first.id)).toBe(false)
    expect(await deleteChatMessage(writer.id, first.id)).toBe(true)
    expect(await deleteChatMessage(owner.id, second.id)).toBe(true)
    unsubscribe()

    expect(await listChat(podcast, broadcast.id, owner.id)).toEqual([])
    expect(events).toEqual([
      { type: 'deleted', podcastId: podcast.id, messageId: first.id },
      { type: 'deleted', podcastId: podcast.id, messageId: second.id },
    ])
  })
})

describe('getWatchablePodcast', () => {
  it("only gives a private podcast to its owner", async () => {
    const owner = await createUser()
    await createPodcast(owner.id, { slug: 'secret', private: true })
    await createPodcast(owner.id, { slug: 'open' })

    expect(await getWatchablePodcast('secret', null)).toBeNull()
    expect(await getWatchablePodcast('secret', (await createUser()).id)).toBeNull()
    expect(await getWatchablePodcast('secret', owner.id)).not.toBeNull()
    expect(await getWatchablePodcast('open', null)).not.toBeNull()
  })
})

describe('liveTokenFrom', () => {
  it('keeps a "+" in the secret, written into the address as it is', () => {
    expect(liveTokenFrom('http://app/api/live/auth?token=ab+c/d=')).toBe('ab+c/d=')
    expect(liveTokenFrom('http://app/api/live/auth?token=ab%2Bc')).toBe('ab+c')
    expect(liveTokenFrom('http://app/api/live/auth?x=1&token=abc')).toBe('abc')
    expect(liveTokenFrom('http://app/api/live/auth')).toBeNull()
    expect(liveTokenFrom('http://app/api/live/auth?token=%E0%A4%A')).toBeNull()
  })
})
