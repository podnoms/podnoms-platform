// Live broadcasts. Owners stream from OBS to a MediaMTX server, which asks us
// (through /api/live/auth) whether each stream may publish: OBS sends
// "live/<podcast id>?key=<the podcast's live key>". The key is kept
// encrypted, so its owner can see it again on the Live tab. MediaMTX records the stream and serves it as HLS, which only
// the app may read; viewers get it through /api/podcasts/$slug/live/hls,
// which applies the podcast's privacy. The app polls MediaMTX's API to see
// which podcasts are live, opening and ending live_broadcast rows; a
// broadcast's recording becomes a private episode once it ends (see
// live-recordings.server.ts). Like episode processing, this runs in-process,
// so only a single app instance may run.
import '@tanstack/react-start/server-only'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { env } from '~/env'
import { db } from '~/server/db/client.server'
import { episodes, liveBroadcasts, liveChatMessages, podcasts, users, type LiveBroadcast } from '~/server/db/schema'
import { ExpiringStore } from '~/server/expiring-store.server'
import { publishLiveEvent, type ChatMessageRecord } from '~/server/live-events.server'
import { finishRecording } from '~/server/live-recordings.server'
import { logger, reportError } from '~/server/logger.server'
import { decryptSecret, encryptSecret } from '~/server/secrets.server'

// How often MediaMTX is asked what's live.
export const pollIntervalMs = 5000
// A stream that drops out (OBS reconnecting, say) and comes back within this
// long continues the same broadcast.
export const reconnectGraceMs = 30_000
// Chat shown when the page opens.
export const chatHistoryLimit = 200
// The least time between one user's chat messages.
export const chatIntervalMs = 1000

// The user MediaMTX expects the app to read streams as; LIVE_SECRET is its password.
export const liveReader = 'podnoms'

export function liveEnabled() {
  return Boolean(env.LIVE_SECRET && env.LIVE_API_URL && env.LIVE_HLS_URL && env.LIVE_RTMP_URL)
}

const livePath = /^live\/([0-9a-f-]{36})$/
export const livePathFor = (podcastId: string) => `live/${podcastId}`

// The podcast's key, or null if it hasn't one (or it can't be read, as when
// AUTH_SECRET has changed; the owner can make a new one).
function readKey(stored: string | null) {
  if (!stored) return null
  try {
    return decryptSecret('podnoms live key', stored)
  } catch {
    return null
  }
}

const streamKeyFor = (podcastId: string, key: string) => `${podcastId}?key=${key}`

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

// Makes the podcast a new live key, replacing any it had (so the old one stops
// working), and returns what goes in OBS. Null unless the podcast belongs to
// the user.
export async function createLiveKey(userId: string, podcastId: string) {
  const key = randomBytes(24).toString('base64url')
  const updated = await db
    .update(podcasts)
    .set({ liveKey: encryptSecret('podnoms live key', key) })
    .where(and(eq(podcasts.id, podcastId), eq(podcasts.userId, userId)))
    .returning({ id: podcasts.id })
  if (updated.length === 0) return null
  return { server: env.LIVE_RTMP_URL ?? '', streamKey: streamKeyFor(podcastId, key) }
}

// Stops the podcast's key working; it can't go live until it gets a new one.
// Returns false unless the podcast belongs to the user.
export async function revokeLiveKey(userId: string, podcastId: string) {
  const updated = await db
    .update(podcasts)
    .set({ liveKey: null })
    .where(and(eq(podcasts.id, podcastId), eq(podcasts.userId, userId)))
    .returning({ id: podcasts.id })
  return updated.length > 0
}

// The title for the next broadcast (or, while live, this one). Empty for the
// default. Returns false unless the podcast belongs to the user.
export async function setLiveTitle(userId: string, podcastId: string, title: string) {
  const liveTitle = title.trim() || null
  const updated = await db
    .update(podcasts)
    .set({ liveTitle })
    .where(and(eq(podcasts.id, podcastId), eq(podcasts.userId, userId)))
    .returning({ id: podcasts.id })
  if (updated.length === 0) return false
  if (!liveTitle) return true
  const open = await db
    .update(liveBroadcasts)
    .set({ title: liveTitle })
    .where(and(eq(liveBroadcasts.podcastId, podcastId), isNull(liveBroadcasts.endedAt)))
    .returning({ id: liveBroadcasts.id })
  if (open.length > 0) publishLiveEvent({ type: 'status', podcastId })
  return true
}

export function defaultLiveTitle(podcastTitle: string, date: Date) {
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return `${podcastTitle} live, ${day}`
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
// podcast's key, or the app reading one.
export async function authorizeLive(request: LiveAuthRequest) {
  if (!liveEnabled()) return false
  switch (request.action) {
    case 'publish': {
      const podcastId = livePath.exec(request.path ?? '')?.[1]
      const key = new URLSearchParams(request.query ?? '').get('key')
      let allowed = false
      if (podcastId && key) {
        const [podcast] = await db
          .select({ liveKey: podcasts.liveKey })
          .from(podcasts)
          .where(eq(podcasts.id, podcastId))
          .limit(1)
        const expected = readKey(podcast?.liveKey ?? null)
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
      return request.user === liveReader && isLiveSecret(request.password)
    default:
      return false
  }
}

type PathList = { pageCount?: number; items?: { name?: string; ready?: boolean; available?: boolean }[] }

// The podcasts MediaMTX has a stream from right now.
export async function listLivePodcastIds() {
  const live = new Set<string>()
  for (let page = 0, pages = 1; page < pages; page++) {
    const url = new URL(`/v3/paths/list?itemsPerPage=500&page=${page}`, env.LIVE_API_URL)
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!response.ok) throw new Error(`MediaMTX said ${response.status} ${response.statusText}`)
    const list = (await response.json()) as PathList
    pages = list.pageCount ?? 1
    for (const item of list.items ?? []) {
      const podcastId = livePath.exec(item.name ?? '')?.[1]
      if (podcastId && (item.ready ?? item.available)) live.add(podcastId)
    }
  }
  return live
}

// Brings live_broadcast in line with what MediaMTX is streaming: opens a
// broadcast for each podcast that has started, and ends those whose stream
// has been gone longer than the grace period, making their recordings into
// episodes. Throws, changing nothing, if MediaMTX can't be reached.
export async function syncLiveBroadcasts(now = new Date()) {
  const live = await listLivePodcastIds()
  const open = await db.select().from(liveBroadcasts).where(isNull(liveBroadcasts.endedAt))
  const openByPodcast = new Map(open.map((broadcast) => [broadcast.podcastId, broadcast]))

  for (const podcastId of live) {
    if (openByPodcast.has(podcastId)) continue
    const [podcast] = await db
      .select({ title: podcasts.title, liveTitle: podcasts.liveTitle })
      .from(podcasts)
      .where(eq(podcasts.id, podcastId))
      .limit(1)
    // Deleted while it was live.
    if (!podcast) continue
    const started = await db
      .insert(liveBroadcasts)
      .values({ podcastId, title: podcast.liveTitle ?? defaultLiveTitle(podcast.title, now), startedAt: now, lastSeenAt: now })
      .onConflictDoNothing()
      .returning({ id: liveBroadcasts.id })
    if (started.length > 0) {
      logger.info({ podcastId }, 'Broadcast started')
      publishLiveEvent({ type: 'status', podcastId })
    }
  }

  const ended: LiveBroadcast[] = []
  for (const broadcast of open) {
    if (live.has(broadcast.podcastId)) {
      await db.update(liveBroadcasts).set({ lastSeenAt: now }).where(eq(liveBroadcasts.id, broadcast.id))
    } else if (now.getTime() - broadcast.lastSeenAt.getTime() > reconnectGraceMs) {
      await db.update(liveBroadcasts).set({ endedAt: broadcast.lastSeenAt }).where(eq(liveBroadcasts.id, broadcast.id))
      logger.info({ podcastId: broadcast.podcastId, broadcastId: broadcast.id }, 'Broadcast ended')
      publishLiveEvent({ type: 'status', podcastId: broadcast.podcastId })
      ended.push(broadcast)
    }
  }
  for (const broadcast of ended) {
    await finishRecording(broadcast).catch((error: unknown) =>
      reportError(error, { broadcastId: broadcast.id, msg: "Could not make a broadcast's recording into an episode" }),
    )
  }
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

// The podcast's open broadcast, if it's live.
export async function getOpenBroadcast(podcastId: string) {
  const [broadcast] = await db
    .select({ id: liveBroadcasts.id, title: liveBroadcasts.title, startedAt: liveBroadcasts.startedAt })
    .from(liveBroadcasts)
    .where(and(eq(liveBroadcasts.podcastId, podcastId), isNull(liveBroadcasts.endedAt)))
    .limit(1)
  return broadcast ?? null
}

export type OpenBroadcast = NonNullable<Awaited<ReturnType<typeof getOpenBroadcast>>>

// The podcast, by slug, if the viewer may watch it: anyone, unless it's
// private, when only its owner may.
export async function getWatchablePodcast(slug: string, viewerId: string | null) {
  const [podcast] = await db
    .select({ id: podcasts.id, userId: podcasts.userId })
    .from(podcasts)
    .where(
      and(
        eq(podcasts.slug, slug),
        viewerId ? or(eq(podcasts.private, false), eq(podcasts.userId, viewerId)) : eq(podcasts.private, false),
      ),
    )
    .limit(1)
  return podcast ?? null
}

// For the owner's Live tab: the stream key, what's on now, and the
// broadcasts so far with the episodes made from them.
export async function getLiveSettings(userId: string, podcastId: string) {
  const [podcast] = await db
    .select({ liveKey: podcasts.liveKey, liveTitle: podcasts.liveTitle })
    .from(podcasts)
    .where(and(eq(podcasts.id, podcastId), eq(podcasts.userId, userId)))
    .limit(1)
  if (!podcast) return null
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
    .where(eq(liveBroadcasts.podcastId, podcastId))
    .orderBy(desc(liveBroadcasts.startedAt))
    .limit(20)
  const key = readKey(podcast.liveKey)
  return {
    // What goes in OBS, or null until the owner makes a key.
    streamKey: key === null ? null : streamKeyFor(podcastId, key),
    liveTitle: podcast.liveTitle,
    server: env.LIVE_RTMP_URL ?? '',
    live: broadcasts.find((broadcast) => broadcast.endedAt === null) ?? null,
    broadcasts: broadcasts.map(({ episode, ...broadcast }) => ({ ...broadcast, episode: episode?.slug ? episode : null })),
  }
}

// --- Chat -----------------------------------------------------------------------

const chatColumns = {
  id: liveChatMessages.id,
  body: liveChatMessages.body,
  createdAt: liveChatMessages.createdAt,
  userId: liveChatMessages.userId,
  author: { name: users.name, image: users.image },
}

// What a viewer is shown of a message: who wrote it by name (their id stays
// on the server), and whether they may delete it.
export function chatMessageFor(message: ChatMessageRecord, viewerId: string | null, ownerId: string) {
  const { userId, ...rest } = message
  return { ...rest, canDelete: viewerId !== null && (userId === viewerId || ownerId === viewerId) }
}

export type ChatMessage = ReturnType<typeof chatMessageFor>

// The newest messages of one of the podcast's broadcasts, oldest first.
export async function listChat(
  podcast: { id: string; userId: string },
  broadcastId: string,
  viewerId: string | null,
) {
  const rows = await db
    .select(chatColumns)
    .from(liveChatMessages)
    .innerJoin(users, eq(users.id, liveChatMessages.userId))
    .innerJoin(liveBroadcasts, eq(liveBroadcasts.id, liveChatMessages.broadcastId))
    .where(and(eq(liveChatMessages.broadcastId, broadcastId), eq(liveBroadcasts.podcastId, podcast.id)))
    .orderBy(desc(liveChatMessages.createdAt), desc(liveChatMessages.id))
    .limit(chatHistoryLimit)
  return rows.reverse().map((message) => chatMessageFor(message, viewerId, podcast.userId))
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
export async function addChatMessage(userId: string, broadcastId: string, body: string) {
  const [broadcast] = await db
    .select({ podcastId: liveBroadcasts.podcastId, ownerId: podcasts.userId })
    .from(liveBroadcasts)
    .innerJoin(podcasts, eq(podcasts.id, liveBroadcasts.podcastId))
    .where(
      and(
        eq(liveBroadcasts.id, broadcastId),
        isNull(liveBroadcasts.endedAt),
        or(eq(podcasts.private, false), eq(podcasts.userId, userId)),
      ),
    )
    .limit(1)
  if (!broadcast) return null
  if (lastMessageAt.get(userId)) throw new ChatTooFastError()
  lastMessageAt.set(userId, true)
  const [inserted] = await db
    .insert(liveChatMessages)
    .values({ broadcastId, userId, body: body.trim() })
    .returning({ id: liveChatMessages.id })
  const [message] = await db
    .select(chatColumns)
    .from(liveChatMessages)
    .innerJoin(users, eq(users.id, liveChatMessages.userId))
    .where(eq(liveChatMessages.id, inserted!.id))
  publishLiveEvent({ type: 'message', podcastId: broadcast.podcastId, message: message! })
  return chatMessageFor(message!, userId, broadcast.ownerId)
}

// Deletes a message the user wrote, or one on their own podcast's broadcast.
// Returns whether one was deleted.
export async function deleteChatMessage(userId: string, messageId: string) {
  const [message] = await db
    .select({ writerId: liveChatMessages.userId, ownerId: podcasts.userId, podcastId: podcasts.id })
    .from(liveChatMessages)
    .innerJoin(liveBroadcasts, eq(liveBroadcasts.id, liveChatMessages.broadcastId))
    .innerJoin(podcasts, eq(podcasts.id, liveBroadcasts.podcastId))
    .where(eq(liveChatMessages.id, messageId))
    .limit(1)
  if (!message || (message.writerId !== userId && message.ownerId !== userId)) return false
  await db.delete(liveChatMessages).where(eq(liveChatMessages.id, messageId))
  publishLiveEvent({ type: 'deleted', podcastId: message.podcastId, messageId })
  return true
}

// --- Video ----------------------------------------------------------------------

// Who may watch which podcast, remembered briefly: players fetch a new part
// of the stream every second or so.
const watchable = new ExpiringStore<{ id: string; userId: string } | null>(10_000)

export async function getWatchablePodcastCached(slug: string, viewerId: string | null) {
  const key = `${slug}\n${viewerId ?? ''}`
  const known = watchable.get(key)
  if (known !== undefined) return known
  const podcast = await getWatchablePodcast(slug, viewerId)
  watchable.set(key, podcast)
  return podcast
}

// The HLS files players ask for: playlists and segments, named by MediaMTX.
export const hlsFileName = /^[\w-]+(\.[\w-]+)*$/

// A file of the podcast's HLS stream from MediaMTX, passed on as it comes.
// Players' query (for low-latency HLS's blocking playlist reloads) goes too.
export async function fetchLiveHls(podcastId: string, file: string, search: string, signal?: AbortSignal) {
  const url = new URL(`/${livePathFor(podcastId)}/${file}${search}`, env.LIVE_HLS_URL)
  let upstream: Response
  try {
    upstream = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${liveReader}:${env.LIVE_SECRET}`).toString('base64')}` },
      signal,
    })
  } catch (error) {
    if (signal?.aborted) return new Response(null, { status: 499 })
    reportError(error, { podcastId, msg: 'Could not reach MediaMTX for live video' })
    return new Response('Live video is unavailable', { status: 502 })
  }
  if (upstream.status === 404) return new Response('Not live', { status: 404 })
  const headers = new Headers()
  for (const name of ['content-type', 'content-length']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  // Playlists change every second; segments never do. Neither is for shared
  // caches, as a private podcast's video is only for its owner.
  headers.set('Cache-Control', file.endsWith('.m3u8') ? 'no-store' : 'private, max-age=3600')
  return new Response(upstream.body, { status: upstream.status, headers })
}
