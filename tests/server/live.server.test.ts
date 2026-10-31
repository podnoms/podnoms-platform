import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { liveBroadcasts, shows } from '~/server/db/schema'
import { notifyFollowersLive } from '~/server/follower-notifications.server'
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
  getWatchableShow,
  listChat,
  liveTokenFrom,
  reconnectGraceMs,
  revokeLiveKey,
  setLiveTitle,
  syncLiveBroadcasts,
} from '~/server/live.server'
import { resetDb } from '../db'
import { createShow, createUser, db } from '../helpers'

vi.mock('~/server/live-recordings.server', () => ({ finishRecording: vi.fn() }))
vi.mock('~/server/follower-notifications.server', () => ({ notifyFollowersLive: vi.fn() }))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(finishRecording).mockReset().mockResolvedValue(null)
  vi.mocked(notifyFollowersLive).mockReset()
})
afterEach(() => vi.restoreAllMocks())

// MediaMTX's API, listing these paths.
function mediamtx(paths: { name: string; ready: boolean }[]) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ pageCount: 1, itemCount: paths.length, items: paths }))
}

const live = (showId: string) => ({ name: `live/${showId}`, ready: true })

function recordEvents() {
  const events: LiveEvent[] = []
  const unsubscribe = subscribeToLiveEvents((event) => events.push(event))
  return { events, unsubscribe }
}

async function openBroadcast(showId: string, values: Partial<typeof liveBroadcasts.$inferInsert> = {}) {
  const [broadcast] = await db
    .insert(liveBroadcasts)
    .values({ showId, title: 'On air', ...values })
    .returning()
  return broadcast!
}

const keyOf = (streamKey: string) => new URLSearchParams(streamKey.split('?')[1]).get('key')!

describe('live keys', () => {
  it('gives the owner a stream key, kept encrypted, which they can see again', async () => {
    const user = await createUser()
    const show = await createShow(user.id)

    const created = await createLiveKey(user.id, show.id)

    expect(created!.server).toBe('rtmp://live.example.com/live')
    expect(created!.streamKey).toMatch(new RegExp(`^${show.id}\\?key=[\\w-]{32}$`))
    const [row] = await db.select({ liveKey: shows.liveKey }).from(shows).where(eq(shows.id, show.id))
    expect(row!.liveKey).not.toContain(keyOf(created!.streamKey))
    expect((await getLiveSettings(user.id, show.id))!.streamKey).toBe(created!.streamKey)

    await revokeLiveKey(user.id, show.id)
    expect((await getLiveSettings(user.id, show.id))!.streamKey).toBeNull()
  })

  it("treats a key that can't be decrypted (AUTH_SECRET changed) as none", async () => {
    const user = await createUser()
    const show = await createShow(user.id, { liveKey: 'not.an.encrypted-key' })
    expect((await getLiveSettings(user.id, show.id))!.streamKey).toBeNull()
    expect(await authorizeLive({ action: 'publish', path: `live/${show.id}`, query: 'key=anything' })).toBe(false)
  })

  it("won't make or revoke a key for someone else's show", async () => {
    const show = await createShow((await createUser()).id)
    const other = await createUser()
    expect(await createLiveKey(other.id, show.id)).toBeNull()
    expect(await revokeLiveKey(other.id, show.id)).toBe(false)
    expect(await getLiveSettings(other.id, show.id)).toBeNull()
  })
})

describe('authorizeLive', () => {
  const publish = (showId: string, key: string | null) => ({
    action: 'publish',
    path: `live/${showId}`,
    protocol: 'rtmp',
    query: key === null ? '' : `key=${encodeURIComponent(key)}`,
  })

  it("lets a stream publish with its show's key, and nothing else", async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    const other = await createShow(user.id)
    const key = keyOf((await createLiveKey(user.id, show.id))!.streamKey)
    await createLiveKey(user.id, other.id)

    expect(await authorizeLive(publish(show.id, key))).toBe(true)
    expect(await authorizeLive(publish(show.id, `${key}x`))).toBe(false)
    expect(await authorizeLive(publish(show.id, null))).toBe(false)
    // Another show's path with this show's key.
    expect(await authorizeLive(publish(other.id, key))).toBe(false)
    expect(await authorizeLive({ ...publish(show.id, key), path: `other/${show.id}` })).toBe(false)
  })

  it('stops a key working once it is replaced or revoked', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    const first = keyOf((await createLiveKey(user.id, show.id))!.streamKey)
    const second = keyOf((await createLiveKey(user.id, show.id))!.streamKey)

    expect(await authorizeLive(publish(show.id, first))).toBe(false)
    expect(await authorizeLive(publish(show.id, second))).toBe(true)
    await revokeLiveKey(user.id, show.id)
    expect(await authorizeLive(publish(show.id, second))).toBe(false)
  })

  it('refuses publishing to a show without a key', async () => {
    const show = await createShow((await createUser()).id)
    expect(await authorizeLive(publish(show.id, 'anything'))).toBe(false)
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
  it("opens a broadcast when a show's stream appears, titled as the owner chose", async () => {
    const user = await createUser()
    const show = await createShow(user.id, { title: 'The Show', liveTitle: 'Q&A night' })
    const plain = await createShow(user.id, { title: 'Other Show' })
    mediamtx([live(show.id), live(plain.id), { name: 'live/not-a-show', ready: true }, { name: `live/${crypto.randomUUID()}`, ready: true }])
    const { events, unsubscribe } = recordEvents()

    await syncLiveBroadcasts(new Date('2026-10-12T20:00:00Z'))
    unsubscribe()

    const open = await db.select().from(liveBroadcasts)
    expect(open.map((b) => [b.showId, b.title, b.endedAt]).sort()).toEqual(
      [
        [show.id, 'Q&A night', null],
        [plain.id, 'Other Show live, 12 October 2026', null],
      ].sort(),
    )
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'status', showId: show.id },
        { type: 'status', showId: plain.id },
      ]),
    )
  })

  it("tells the show's followers once when it goes live, not when it reconnects", async () => {
    const show = await createShow((await createUser()).id, { title: 'The Show', liveTitle: 'Q&A night' })
    const start = new Date('2026-10-12T20:00:00Z')
    const fetch = mediamtx([live(show.id)])
    await syncLiveBroadcasts(start)
    expect(notifyFollowersLive).toHaveBeenCalledExactlyOnceWith(show.id, 'Q&A night')

    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [] }))
    await syncLiveBroadcasts(new Date(start.getTime() + 1000))
    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [live(show.id)] }))
    await syncLiveBroadcasts(new Date(start.getTime() + 2000))
    expect(notifyFollowersLive).toHaveBeenCalledTimes(1)
  })

  it('ignores paths that are not ready yet', async () => {
    const show = await createShow((await createUser()).id)
    mediamtx([{ name: `live/${show.id}`, ready: false }])
    await syncLiveBroadcasts()
    expect(await db.select().from(liveBroadcasts)).toEqual([])
  })

  it('keeps a broadcast open through a short drop-out, then ends it and makes its recording an episode', async () => {
    const show = await createShow((await createUser()).id)
    const start = new Date('2026-10-12T20:00:00Z')
    const at = (ms: number) => new Date(start.getTime() + ms)
    const fetch = mediamtx([live(show.id)])
    await syncLiveBroadcasts(start)
    const [broadcast] = await db.select().from(liveBroadcasts)

    // Gone, but within the grace period: still open.
    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [] }))
    await syncLiveBroadcasts(at(reconnectGraceMs - 1000))
    // Back again: the same broadcast carries on.
    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [live(show.id)] }))
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
    expect(events).toEqual([{ type: 'status', showId: show.id }])
    expect(finishRecording).toHaveBeenCalledWith(expect.objectContaining({ id: broadcast!.id }))
  })

  it('marks a broadcast interrupted as soon as its stream goes, telling viewers, and clears it when it comes back', async () => {
    const show = await createShow((await createUser()).id)
    const start = new Date('2026-10-12T20:00:00Z')
    const fetch = mediamtx([live(show.id)])
    await syncLiveBroadcasts(start)

    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [] }))
    let { events, unsubscribe } = recordEvents()
    await syncLiveBroadcasts(new Date(start.getTime() + 5000))
    // Not again on the next poll.
    await syncLiveBroadcasts(new Date(start.getTime() + 10_000))
    unsubscribe()
    expect(events).toEqual([{ type: 'status', showId: show.id }])
    expect((await getOpenBroadcast(show.id))!.interruptedAt).toEqual(new Date(start.getTime() + 5000))

    fetch.mockImplementation(async () => Response.json({ pageCount: 1, items: [live(show.id)] }))
    ;({ events, unsubscribe } = recordEvents())
    await syncLiveBroadcasts(new Date(start.getTime() + 15_000))
    unsubscribe()
    expect(events).toEqual([{ type: 'status', showId: show.id }])
    expect((await getOpenBroadcast(show.id))!.interruptedAt).toBeNull()
  })

  it("changes nothing when MediaMTX can't be reached", async () => {
    const show = await createShow((await createUser()).id)
    await openBroadcast(show.id, { lastSeenAt: new Date(Date.now() - 10 * reconnectGraceMs) })
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
    const show = await createShow((await createUser()).id)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get('page'))
      return Response.json({ pageCount: 2, items: page === 1 ? [live(show.id)] : [] })
    })
    await syncLiveBroadcasts()
    expect(await db.select({ showId: liveBroadcasts.showId }).from(liveBroadcasts)).toEqual([{ showId: show.id }])
  })
})

describe('endBroadcast', () => {
  it('lets the owner end an interrupted broadcast at once, telling viewers and making the episode', async () => {
    const owner = await createUser()
    const show = await createShow(owner.id)
    const lastSeenAt = new Date(Date.now() - 20_000)
    const broadcast = await openBroadcast(show.id, { lastSeenAt, interruptedAt: new Date(Date.now() - 15_000) })
    const { events, unsubscribe } = recordEvents()

    expect(await endBroadcast(owner.id, broadcast.id)).toBe(true)
    unsubscribe()

    const [ended] = await db.select().from(liveBroadcasts)
    expect(ended).toMatchObject({ endedAt: lastSeenAt, interruptedAt: null })
    expect(events).toEqual([{ type: 'status', showId: show.id }])
    expect(finishRecording).toHaveBeenCalledWith(expect.objectContaining({ id: broadcast.id }))
    expect(await getOpenBroadcast(show.id)).toBeNull()
    // Once only, even if the poller gets there too.
    expect(await endBroadcast(owner.id, broadcast.id)).toBe(false)
    expect(finishRecording).toHaveBeenCalledTimes(1)
  })

  it("won't end someone else's broadcast, or one whose stream is still coming in", async () => {
    const owner = await createUser()
    const show = await createShow(owner.id)
    const streaming = await openBroadcast(show.id)
    expect(await endBroadcast(owner.id, streaming.id)).toBe(false)

    await db.update(liveBroadcasts).set({ interruptedAt: new Date() }).where(eq(liveBroadcasts.id, streaming.id))
    expect(await endBroadcast((await createUser()).id, streaming.id)).toBe(false)
    expect(await getOpenBroadcast(show.id)).not.toBeNull()
    expect(finishRecording).not.toHaveBeenCalled()
  })
})

describe('setLiveTitle', () => {
  it("renames the broadcast that's on now, and the next", async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    await openBroadcast(show.id)

    expect(await setLiveTitle(user.id, show.id, '  Late show ')).toBe(true)

    expect((await db.select().from(liveBroadcasts))[0]!.title).toBe('Late show')
    expect((await getLiveSettings(user.id, show.id))!.liveTitle).toBe('Late show')
    expect(await setLiveTitle(user.id, show.id, '')).toBe(true)
    expect((await getLiveSettings(user.id, show.id))!.liveTitle).toBeNull()
    expect(await setLiveTitle((await createUser()).id, show.id, 'Mine now')).toBe(false)
  })
})

describe('chat', () => {
  it('lets signed-in viewers chat while live, for everyone watching to see', async () => {
    const owner = await createUser({ name: 'Host' })
    const show = await createShow(owner.id)
    const broadcast = await openBroadcast(show.id)
    const viewer = await createUser({ name: 'Listener' })
    const { events, unsubscribe } = recordEvents()

    const message = await addChatMessage(viewer.id, broadcast.id, '  Hello!  ')
    unsubscribe()

    expect(message).toMatchObject({ body: 'Hello!', author: { name: 'Listener' }, canDelete: true })
    expect(message).not.toHaveProperty('userId')
    expect(events).toEqual([
      { type: 'message', showId: show.id, message: expect.objectContaining({ body: 'Hello!', userId: viewer.id }) },
    ])
    const owners = await listChat(show, broadcast.id, owner.id)
    const anyone = await listChat(show, broadcast.id, null)
    expect(owners.map((m) => [m.body, m.canDelete])).toEqual([['Hello!', true]])
    expect(anyone.map((m) => [m.body, m.canDelete])).toEqual([['Hello!', false]])
  })

  it('stores a GIF with a message, for everyone to see', async () => {
    const owner = await createUser()
    const show = await createShow(owner.id)
    const broadcast = await openBroadcast(show.id)
    const gif = { provider: 'klipy' as const, id: 'happy', title: 'Happy', url: 'https://static.klipy.com/a.webp', width: 220, height: 124 }

    const message = await addChatMessage(owner.id, broadcast.id, '', gif)

    expect(message).toMatchObject({ body: '', gif })
    expect((await listChat(show, broadcast.id, null)).map((m) => m.gif)).toEqual([gif])
  })

  it('only lists a broadcast with the show it belongs to', async () => {
    const user = await createUser()
    const secret = await createShow(user.id, { private: true })
    const open = await createShow(user.id)
    const broadcast = await openBroadcast(secret.id)
    await addChatMessage(user.id, broadcast.id, 'Private chat')
    expect(await listChat(open, broadcast.id, null)).toEqual([])
  })

  it("refuses messages once the broadcast has ended, and to those who can't see a private show", async () => {
    const owner = await createUser()
    const secret = await createShow(owner.id, { private: true })
    const broadcast = await openBroadcast(secret.id)
    const stranger = await createUser()

    expect(await addChatMessage(stranger.id, broadcast.id, 'Hi')).toBeNull()
    expect(await addChatMessage(owner.id, broadcast.id, 'Hi')).not.toBeNull()

    await db.update(liveBroadcasts).set({ endedAt: new Date() }).where(eq(liveBroadcasts.id, broadcast.id))
    expect(await addChatMessage(owner.id, broadcast.id, 'Still there?')).toBeNull()
  })

  it('slows down someone writing too fast', async () => {
    const show = await createShow((await createUser()).id)
    const broadcast = await openBroadcast(show.id)
    const viewer = await createUser()

    await addChatMessage(viewer.id, broadcast.id, 'one')
    await expect(addChatMessage(viewer.id, broadcast.id, 'two')).rejects.toBeInstanceOf(ChatTooFastError)
    // Others aren't held up.
    expect(await addChatMessage((await createUser()).id, broadcast.id, 'three')).not.toBeNull()
  })

  it('lets the writer or the show owner delete a message', async () => {
    const owner = await createUser()
    const show = await createShow(owner.id)
    const broadcast = await openBroadcast(show.id)
    const writer = await createUser()
    const stranger = await createUser()
    const first = (await addChatMessage(writer.id, broadcast.id, 'first'))!
    const second = (await addChatMessage((await createUser()).id, broadcast.id, 'second'))!
    const { events, unsubscribe } = recordEvents()

    expect(await deleteChatMessage(stranger.id, first.id)).toBe(false)
    expect(await deleteChatMessage(writer.id, first.id)).toBe(true)
    expect(await deleteChatMessage(owner.id, second.id)).toBe(true)
    unsubscribe()

    expect(await listChat(show, broadcast.id, owner.id)).toEqual([])
    expect(events).toEqual([
      { type: 'deleted', showId: show.id, messageId: first.id },
      { type: 'deleted', showId: show.id, messageId: second.id },
    ])
  })
})

describe('getWatchableShow', () => {
  it("only gives a private show to its owner", async () => {
    const owner = await createUser()
    await createShow(owner.id, { slug: 'secret', private: true })
    await createShow(owner.id, { slug: 'open' })

    expect(await getWatchableShow('secret', null)).toBeNull()
    expect(await getWatchableShow('secret', (await createUser()).id)).toBeNull()
    expect(await getWatchableShow('secret', owner.id)).not.toBeNull()
    expect(await getWatchableShow('open', null)).not.toBeNull()
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
