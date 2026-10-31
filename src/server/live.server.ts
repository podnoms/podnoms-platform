// Live broadcasts. Owners stream from OBS to a MediaMTX server, which asks us
// (through /api/live/auth) whether each stream may publish: OBS sends
// "live/<show id>?key=<the show's live key>". The key is kept
// encrypted, so its owner can see it again in the Go live dialog. MediaMTX
// records the stream and serves it as HLS, which only the app may read;
// viewers get it through /api/shows/$slug/live/hls, which applies the
// show's privacy. The app polls MediaMTX's API to see
// which shows are live, opening and ending live_broadcast rows; a
// broadcast's recording becomes a private episode once it ends (see
// live-recordings.server.ts). Like episode processing, this runs in-process,
// so only a single app instance may run.
import '@tanstack/react-start/server-only'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { env } from '~/env'
import type { ChatGif, GifConfig } from '~/lib/gifs'
import { db } from '~/server/db/client.server'
import { episodes, liveBroadcasts, liveChatMessages, shows, users, type LiveBroadcast } from '~/server/db/schema'
import { ExpiringStore } from '~/server/expiring-store.server'
import { notifyFollowersLive } from '~/server/follower-notifications.server'
import { publishLiveEvent, type ChatMessageRecord } from '~/server/live-events.server'
import { finishRecording } from '~/server/live-recordings.server'
import { logger, reportError } from '~/server/logger.server'
import { decryptSecret, encryptSecret } from '~/server/secrets.server'

// How often MediaMTX is asked what's live.
export const pollIntervalMs = 5000
// A stream that drops out (OBS reconnecting, say) and comes back within this
// long continues the same broadcast; after it, the broadcast ends. The owner
// is asked whether they've finished as soon as it drops, and can end it sooner.
export const reconnectGraceMs = 5 * 60_000
// Chat shown when the page opens.
export const chatHistoryLimit = 200
// The least time between one user's chat messages.
export const chatIntervalMs = 1000

// The user the app reads streams and calls MediaMTX's API as; LIVE_SECRET is
// its password. MediaMTX asks /api/live/auth about those requests too (its
// defaults don't exempt the API everywhere), which lets them through.
export const liveReader = 'podnoms'

const readerAuthorization = () => `Basic ${Buffer.from(`${liveReader}:${env.LIVE_SECRET}`).toString('base64')}`

export function liveEnabled() {
  return Boolean(env.LIVE_SECRET && env.LIVE_API_URL && env.LIVE_HLS_URL && env.LIVE_RTMP_URL)
}

const livePath = /^live\/([0-9a-f-]{36})$/
export const livePathFor = (showId: string) => `live/${showId}`

// The show's key, or null if it hasn't one (or it can't be read, as when
// AUTH_SECRET has changed; the owner can make a new one).
function readKey(stored: string | null) {
  if (!stored) return null
  try {
    return decryptSecret('podnoms live key', stored)
  } catch {
    return null
  }
}

const streamKeyFor = (showId: string, key: string) => `${showId}?key=${key}`

function sameText(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

// LIVE_SECRET, as sent by MediaMTX or the app, compared in constant time.
export function isLiveSecret(value: string | null | undefined) {
  return Boolean(env.LIVE_SECRET && value && sameText(value, env.LIVE_SECRET))
}

// The ?token= MediaMTX sends, which is LIVE_SECRET as it was written into its
// authentication address, usually unencoded. Read without form decoding, which
// would turn a "+" (common in base64 secrets) into a space.
export function liveTokenFrom(url: string) {
  const raw = /[?&]token=([^&#]*)/.exec(new URL(url).search)?.[1]
  if (raw === undefined) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

// --- Keys -------------------------------------------------------------------

// Makes the show a new live key, replacing any it had (so the old one stops
// working), and returns what goes in OBS. Null unless the show belongs to
// the user.
export async function createLiveKey(userId: string, showId: string) {
  const key = randomBytes(24).toString('base64url')
  const updated = await db
    .update(shows)
    .set({ liveKey: encryptSecret('podnoms live key', key) })
    .where(and(eq(shows.id, showId), eq(shows.userId, userId)))
    .returning({ id: shows.id })
  if (updated.length === 0) return null
  return { server: env.LIVE_RTMP_URL ?? '', streamKey: streamKeyFor(showId, key) }
}

// Stops the show's key working; it can't go live until it gets a new one.
// Returns false unless the show belongs to the user.
export async function revokeLiveKey(userId: string, showId: string) {
  const updated = await db
    .update(shows)
    .set({ liveKey: null })
    .where(and(eq(shows.id, showId), eq(shows.userId, userId)))
    .returning({ id: shows.id })
  return updated.length > 0
}

// The title for the next broadcast (or, while live, this one). Empty for the
// default. Returns false unless the show belongs to the user.
export async function setLiveTitle(userId: string, showId: string, title: string) {
  const liveTitle = title.trim() || null
  const updated = await db
    .update(shows)
    .set({ liveTitle })
    .where(and(eq(shows.id, showId), eq(shows.userId, userId)))
    .returning({ id: shows.id })
  if (updated.length === 0) return false
  if (!liveTitle) return true
  const open = await db
    .update(liveBroadcasts)
    .set({ title: liveTitle })
    .where(and(eq(liveBroadcasts.showId, showId), isNull(liveBroadcasts.endedAt)))
    .returning({ id: liveBroadcasts.id })
  if (open.length > 0) publishLiveEvent({ type: 'status', showId })
  return true
}

export function defaultLiveTitle(showTitle: string, date: Date) {
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return `${showTitle} live, ${day}`
}

// --- MediaMTX -----------------------------------------------------------------

// What MediaMTX posts to its HTTP authentication address.
export type LiveAuthRequest = {
  user?: string
  password?: string
  ip?: string
  action?: string
  path?: string
  protocol?: string
  query?: string
}

// Whether MediaMTX may let the request through: a stream publishing with its
// show's key, or the app reading one or calling the API.
export async function authorizeLive(request: LiveAuthRequest) {
  if (!liveEnabled()) return false
  switch (request.action) {
    case 'publish': {
      const showId = livePath.exec(request.path ?? '')?.[1]
      const key = new URLSearchParams(request.query ?? '').get('key')
      let allowed = false
      if (showId && key) {
        const [show] = await db
          .select({ liveKey: shows.liveKey })
          .from(shows)
          .where(eq(shows.id, showId))
          .limit(1)
        const expected = readKey(show?.liveKey ?? null)
        allowed = expected !== null && sameText(key, expected)
      }
      if (allowed) {
        logger.info({ path: request.path, protocol: request.protocol }, 'Live stream starting')
        // So viewers don't wait for the next poll.
        if (state.podnomsLivePoller) setTimeout(() => void syncSafely(), 2000).unref?.()
      } else {
        logger.warn({ path: request.path, ip: request.ip, protocol: request.protocol }, 'Refused a live stream')
      }
      return allowed
    }
    case 'read':
    case 'playback':
    case 'api':
      return request.user === liveReader && isLiveSecret(request.password)
    default:
      return false
  }
}

type PathList = { pageCount?: number; items?: { name?: string; ready?: boolean; available?: boolean }[] }

// The shows MediaMTX has a stream from right now.
export async function listLiveShowIds() {
  const live = new Set<string>()
  for (let page = 0, pages = 1; page < pages; page++) {
    const url = new URL(`/v3/paths/list?itemsPerPage=500&page=${page}`, env.LIVE_API_URL)
    const response = await fetch(url, {
      headers: { Authorization: readerAuthorization() },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) throw new Error(`MediaMTX said ${response.status} ${response.statusText}`)
    const list = (await response.json()) as PathList
    pages = list.pageCount ?? 1
    for (const item of list.items ?? []) {
      const showId = livePath.exec(item.name ?? '')?.[1]
      if (showId && (item.ready ?? item.available)) live.add(showId)
    }
  }
  return live
}

// Brings live_broadcast in line with what MediaMTX is streaming: opens a
// broadcast for each show that has started, and ends those whose stream
// has been gone longer than the grace period, making their recordings into
// episodes. Throws, changing nothing, if MediaMTX can't be reached.
export async function syncLiveBroadcasts(now = new Date()) {
  const live = await listLiveShowIds()
  const open = await db.select().from(liveBroadcasts).where(isNull(liveBroadcasts.endedAt))
  const openByShow = new Map(open.map((broadcast) => [broadcast.showId, broadcast]))

  for (const showId of live) {
    if (openByShow.has(showId)) continue
    const [show] = await db
      .select({ title: shows.title, liveTitle: shows.liveTitle })
      .from(shows)
      .where(eq(shows.id, showId))
      .limit(1)
    // Deleted while it was live.
    if (!show) continue
    const title = show.liveTitle ?? defaultLiveTitle(show.title, now)
    const started = await db
      .insert(liveBroadcasts)
      .values({ showId, title, startedAt: now, lastSeenAt: now })
      .onConflictDoNothing()
      .returning({ id: liveBroadcasts.id })
    if (started.length > 0) {
      logger.info({ showId }, 'Broadcast started')
      publishLiveEvent({ type: 'status', showId })
      notifyFollowersLive(showId, title)
    }
  }

  for (const broadcast of open) {
    if (live.has(broadcast.showId)) {
      await db
        .update(liveBroadcasts)
        .set({ lastSeenAt: now, interruptedAt: null })
        .where(eq(liveBroadcasts.id, broadcast.id))
      if (broadcast.interruptedAt) {
        logger.info({ broadcastId: broadcast.id }, 'Broadcast reconnected')
        publishLiveEvent({ type: 'status', showId: broadcast.showId })
      }
    } else if (now.getTime() - broadcast.lastSeenAt.getTime() > reconnectGraceMs) {
      await closeBroadcast(broadcast, broadcast.lastSeenAt)
    } else if (!broadcast.interruptedAt) {
      await db.update(liveBroadcasts).set({ interruptedAt: now }).where(eq(liveBroadcasts.id, broadcast.id))
      logger.info({ broadcastId: broadcast.id }, 'Broadcast interrupted')
      publishLiveEvent({ type: 'status', showId: broadcast.showId })
    }
  }
}

// Ends an open broadcast, telling its viewers, and makes its recording an
// episode in the background. Does nothing if it has already ended (the
// owner and the poller may both get there). Returns whether it ended it.
async function closeBroadcast(broadcast: LiveBroadcast, endedAt: Date) {
  const closed = await db
    .update(liveBroadcasts)
    .set({ endedAt, interruptedAt: null })
    .where(and(eq(liveBroadcasts.id, broadcast.id), isNull(liveBroadcasts.endedAt)))
    .returning({ id: liveBroadcasts.id })
  if (closed.length === 0) return false
  logger.info({ showId: broadcast.showId, broadcastId: broadcast.id }, 'Broadcast ended')
  publishLiveEvent({ type: 'status', showId: broadcast.showId })
  // MediaMTX has finished writing the recording by now: the stream is gone.
  void finishRecording(broadcast).catch((error: unknown) =>
    reportError(error, { broadcastId: broadcast.id, msg: "Could not make a broadcast's recording into an episode" }),
  )
  return true
}

// The owner says they've finished: ends their broadcast now rather than after
// the grace period. Only while its stream is gone, as one that's still coming
// in would only start a new broadcast. Returns false unless the broadcast is
// the user's, open and interrupted.
export async function endBroadcast(userId: string, broadcastId: string) {
  const [row] = await db
    .select({ broadcast: liveBroadcasts })
    .from(liveBroadcasts)
    .innerJoin(shows, eq(shows.id, liveBroadcasts.showId))
    .where(
      and(
        eq(liveBroadcasts.id, broadcastId),
        eq(shows.userId, userId),
        isNull(liveBroadcasts.endedAt),
        isNotNull(liveBroadcasts.interruptedAt),
      ),
    )
    .limit(1)
  if (!row) return false
  return closeBroadcast(row.broadcast, row.broadcast.lastSeenAt)
}

// Kept across dev server reloads, which re-run this module.
const state = globalThis as {
  podnomsLivePoller?: ReturnType<typeof setInterval>
  podnomsLiveSync?: Promise<void> | null
  podnomsLiveFailing?: boolean
}

// One sync at a time. A failure is reported when MediaMTX first becomes
// unreachable, not on every poll after.
function syncSafely() {
  state.podnomsLiveSync ??= syncLiveBroadcasts()
    .then(() => {
      if (state.podnomsLiveFailing) logger.info('MediaMTX is reachable again')
      state.podnomsLiveFailing = false
    })
    .catch((error: unknown) => {
      if (!state.podnomsLiveFailing) reportError(error, { msg: 'Could not check MediaMTX for live streams' })
      state.podnomsLiveFailing = true
    })
    .finally(() => {
      state.podnomsLiveSync = null
    })
  return state.podnomsLiveSync
}

// Starts polling MediaMTX, if live broadcasts are set up. Started with the
// first request (from src/start.ts); later calls do nothing.
export function startLivePoller() {
  if (!liveEnabled() || state.podnomsLivePoller) return
  state.podnomsLivePoller = setInterval(() => void syncSafely(), pollIntervalMs)
  state.podnomsLivePoller.unref?.()
  void syncSafely()
}

// --- Status -------------------------------------------------------------------

// The show's open broadcast, if it's live (or interrupted, waiting for OBS).
export async function getOpenBroadcast(showId: string) {
  const [broadcast] = await db
    .select({
      id: liveBroadcasts.id,
      title: liveBroadcasts.title,
      startedAt: liveBroadcasts.startedAt,
      // Set while the stream is gone (see syncLiveBroadcasts).
      interruptedAt: liveBroadcasts.interruptedAt,
    })
    .from(liveBroadcasts)
    .where(and(eq(liveBroadcasts.showId, showId), isNull(liveBroadcasts.endedAt)))
    .limit(1)
  return broadcast ?? null
}

export type OpenBroadcast = NonNullable<Awaited<ReturnType<typeof getOpenBroadcast>>>

// Which of these shows have an open broadcast.
export async function liveShowIdsAmong(showIds: string[]) {
  if (!liveEnabled() || showIds.length === 0) return new Set<string>()
  const open = await db
    .select({ showId: liveBroadcasts.showId })
    .from(liveBroadcasts)
    .where(and(inArray(liveBroadcasts.showId, showIds), isNull(liveBroadcasts.endedAt)))
  return new Set(open.map((broadcast) => broadcast.showId))
}

// The slugs of the live shows the viewer may watch.
export async function listLiveSlugs(viewerId: string) {
  if (!liveEnabled()) return []
  const live = await db
    .select({ slug: shows.slug })
    .from(liveBroadcasts)
    .innerJoin(shows, eq(shows.id, liveBroadcasts.showId))
    .where(and(isNull(liveBroadcasts.endedAt), or(eq(shows.private, false), eq(shows.userId, viewerId))))
  return live.map((show) => show.slug)
}

// The show, by slug, if the viewer may watch it: anyone, unless it's
// private, when only its owner may.
export async function getWatchableShow(slug: string, viewerId: string | null) {
  const [show] = await db
    .select({ id: shows.id, userId: shows.userId })
    .from(shows)
    .where(
      and(
        eq(shows.slug, slug),
        viewerId ? or(eq(shows.private, false), eq(shows.userId, viewerId)) : eq(shows.private, false),
      ),
    )
    .limit(1)
  return show ?? null
}

// For the owner's Go live dialog: the stream key, what's on now, and the
// broadcasts so far with the episodes made from them.
export async function getLiveSettings(userId: string, showId: string) {
  const [show] = await db
    .select({ liveKey: shows.liveKey, liveTitle: shows.liveTitle })
    .from(shows)
    .where(and(eq(shows.id, showId), eq(shows.userId, userId)))
    .limit(1)
  if (!show) return null
  const broadcasts = await db
    .select({
      id: liveBroadcasts.id,
      title: liveBroadcasts.title,
      startedAt: liveBroadcasts.startedAt,
      endedAt: liveBroadcasts.endedAt,
      episode: { slug: episodes.slug, status: episodes.status },
    })
    .from(liveBroadcasts)
    .leftJoin(episodes, eq(episodes.id, liveBroadcasts.episodeId))
    .where(eq(liveBroadcasts.showId, showId))
    .orderBy(desc(liveBroadcasts.startedAt))
    .limit(20)
  const key = readKey(show.liveKey)
  return {
    // What goes in OBS, or null until the owner makes a key.
    streamKey: key === null ? null : streamKeyFor(showId, key),
    liveTitle: show.liveTitle,
    server: env.LIVE_RTMP_URL ?? '',
    live: broadcasts.find((broadcast) => broadcast.endedAt === null) ?? null,
    broadcasts: broadcasts.map(({ episode, ...broadcast }) => ({ ...broadcast, episode: episode?.slug ? episode : null })),
  }
}

// Which GIF provider the chat uses, and its key for browsers to search with:
// KLIPY if it has a key, else GIPHY, else none (no GIF button).
export function gifConfig(): GifConfig | null {
  if (env.KLIPY_API_KEY) return { provider: 'klipy', key: env.KLIPY_API_KEY }
  if (env.GIPHY_API_KEY) return { provider: 'giphy', key: env.GIPHY_API_KEY }
  return null
}

// --- Chat -----------------------------------------------------------------------

const chatColumns = {
  id: liveChatMessages.id,
  body: liveChatMessages.body,
  createdAt: liveChatMessages.createdAt,
  userId: liveChatMessages.userId,
  author: { name: users.name, image: users.image },
  gif: liveChatMessages.gif,
}

// What a viewer is shown of a message: who wrote it by name (their id stays
// on the server), and whether they may delete it.
export function chatMessageFor(message: ChatMessageRecord, viewerId: string | null, ownerId: string) {
  const { userId, ...rest } = message
  return { ...rest, canDelete: viewerId !== null && (userId === viewerId || ownerId === viewerId) }
}

export type ChatMessage = ReturnType<typeof chatMessageFor>

// The newest messages of one of the show's broadcasts, oldest first.
export async function listChat(
  show: { id: string; userId: string },
  broadcastId: string,
  viewerId: string | null,
) {
  const rows = await db
    .select(chatColumns)
    .from(liveChatMessages)
    .innerJoin(users, eq(users.id, liveChatMessages.userId))
    .innerJoin(liveBroadcasts, eq(liveBroadcasts.id, liveChatMessages.broadcastId))
    .where(and(eq(liveChatMessages.broadcastId, broadcastId), eq(liveBroadcasts.showId, show.id)))
    .orderBy(desc(liveChatMessages.createdAt), desc(liveChatMessages.id))
    .limit(chatHistoryLimit)
  return rows.reverse().map((message) => chatMessageFor(message, viewerId, show.userId))
}

export class ChatTooFastError extends Error {
  constructor() {
    super('Slow down a little')
    this.name = 'ChatTooFastError'
  }
}

const lastMessageAt = new ExpiringStore<true>(chatIntervalMs)

// Posts to the chat of a broadcast that's live, if the user may watch it.
// Returns the message, or null if there's no such broadcast for them.
export async function addChatMessage(userId: string, broadcastId: string, body: string, gif?: ChatGif) {
  const [broadcast] = await db
    .select({ showId: liveBroadcasts.showId, ownerId: shows.userId })
    .from(liveBroadcasts)
    .innerJoin(shows, eq(shows.id, liveBroadcasts.showId))
    .where(
      and(
        eq(liveBroadcasts.id, broadcastId),
        isNull(liveBroadcasts.endedAt),
        or(eq(shows.private, false), eq(shows.userId, userId)),
      ),
    )
    .limit(1)
  if (!broadcast) return null
  if (lastMessageAt.get(userId)) throw new ChatTooFastError()
  lastMessageAt.set(userId, true)
  const [inserted] = await db
    .insert(liveChatMessages)
    .values({ broadcastId, userId, body: body.trim(), gif: gif ?? null })
    .returning({ id: liveChatMessages.id })
  const [message] = await db
    .select(chatColumns)
    .from(liveChatMessages)
    .innerJoin(users, eq(users.id, liveChatMessages.userId))
    .where(eq(liveChatMessages.id, inserted!.id))
  publishLiveEvent({ type: 'message', showId: broadcast.showId, message: message! })
  return chatMessageFor(message!, userId, broadcast.ownerId)
}

// Deletes a message the user wrote, or one on their own show's broadcast.
// Returns whether one was deleted.
export async function deleteChatMessage(userId: string, messageId: string) {
  const [message] = await db
    .select({ writerId: liveChatMessages.userId, ownerId: shows.userId, showId: shows.id })
    .from(liveChatMessages)
    .innerJoin(liveBroadcasts, eq(liveBroadcasts.id, liveChatMessages.broadcastId))
    .innerJoin(shows, eq(shows.id, liveBroadcasts.showId))
    .where(eq(liveChatMessages.id, messageId))
    .limit(1)
  if (!message || (message.writerId !== userId && message.ownerId !== userId)) return false
  await db.delete(liveChatMessages).where(eq(liveChatMessages.id, messageId))
  publishLiveEvent({ type: 'deleted', showId: message.showId, messageId })
  return true
}

// --- Video ----------------------------------------------------------------------

// Who may watch which show, remembered briefly: players fetch a new part
// of the stream every second or so.
const watchable = new ExpiringStore<{ id: string; userId: string } | null>(10_000)

export async function getWatchableShowCached(slug: string, viewerId: string | null) {
  const key = `${slug}\n${viewerId ?? ''}`
  const known = watchable.get(key)
  if (known !== undefined) return known
  const show = await getWatchableShow(slug, viewerId)
  watchable.set(key, show)
  return show
}

// The HLS files players ask for: playlists and segments, named by MediaMTX.
export const hlsFileName = /^[\w-]+(\.[\w-]+)*$/

// A file of the show's HLS stream from MediaMTX, passed on as it comes.
// Players' query (for low-latency HLS's blocking playlist reloads) goes too.
export async function fetchLiveHls(showId: string, file: string, search: string, signal?: AbortSignal) {
  const url = new URL(`/${livePathFor(showId)}/${file}${search}`, env.LIVE_HLS_URL)
  let upstream: Response
  try {
    upstream = await fetch(url, {
      headers: { Authorization: readerAuthorization() },
      signal,
    })
  } catch (error) {
    if (signal?.aborted) return new Response(null, { status: 499 })
    reportError(error, { showId, msg: 'Could not reach MediaMTX for live video' })
    return new Response('Live video is unavailable', { status: 502 })
  }
  if (upstream.status === 404) return new Response('Not live', { status: 404 })
  const headers = new Headers()
  for (const name of ['content-type', 'content-length']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  // Playlists change every second; segments never do. Neither is for shared
  // caches, as a private show's video is only for its owner.
  headers.set('Cache-Control', file.endsWith('.m3u8') ? 'no-store' : 'private, max-age=3600')
  return new Response(upstream.body, { status: upstream.status, headers })
}
