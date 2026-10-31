// Shows that follow a channel (a YouTube channel, a Mixcloud user…): the
// channel's newest uploads become episodes, and it's checked now and then
// for new ones (the channel-check job, see jobs.server.ts).
//
// Listing a channel (see channel-listing.server.ts) asks the platform for just
// its newest uploads, through the download throttle like the downloads.
//
// A show can follow a playlist the same way. Admins' shows aren't held
// to the channel episode limit: they import everything a channel or playlist
// has.
import '@tanstack/react-start/server-only'
import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import type { NewChannelShowInput } from '~/lib/channel-schema'
import { parseChannelUrl, parsePlaylistUrl, type Platform } from '~/lib/platforms'
import { plainTextToHtml } from '~/lib/rich-text'
import { db } from '~/server/db/client.server'
import { channelItems, channels, shows, users, type Channel } from '~/server/db/schema'
import { RateLimitedError, withDownloadSlot } from '~/server/download-throttle.server'
import { publishEpisodeEvent } from '~/server/episode-events.server'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { availableEpisodeSlug, temporaryEpisodeSlug } from '~/server/episode-slugs.server'
import { insertEpisode } from '~/server/episodes.server'
import { deleteImage, downloadImage } from '~/server/images.server'
import { logger, reportError } from '~/server/logger.server'
import { notifyNewEpisodes } from '~/server/notifications.server'
import { createShow } from '~/server/shows.server'
import { listChannel, type ChannelEntry, type ChannelListing } from '~/server/channel-listing.server'
import { getSiteSettings } from '~/server/site-settings.server'

// Users can ask for a check this often at most.
export const manualCheckIntervalMs = 15 * 60_000
// After an admin's channel has been imported whole, later checks list this
// many of its newest uploads, plenty to catch what came out since.
const adminRecheckLimit = 50
// Scheduled checks are spread out by this much either way.
const checkJitter = 0.1
// Uploads shorter than this are Shorts or trailers, not episodes.
const minDurationSeconds = 60

// What YouTube playlists list in place of videos that have gone.
const unavailableTitles = ['[Private video]', '[Deleted video]']

// Uploads worth making episodes of.
const isEpisode = (entry: ChannelEntry) =>
  !entry.live &&
  (entry.durationSeconds == null || entry.durationSeconds >= minDurationSeconds) &&
  !unavailableTitles.includes(entry.title ?? '')

export type ChannelKind = 'channel' | 'playlist'

// A name for the channel from its link, e.g. "@someone", until its own title is known.
export function nameFromChannelUrl(url: string) {
  const parsed = new URL(url)
  const parts = parsed.pathname.split('/').filter(Boolean)
  return (
    parsed.searchParams.get('list') ??
    parts.filter((part) => !['channel', 'c', 'user', 'videos', 'uploads', 'playlist', 'playlists', 'sets', 'tracks'].includes(part)).at(-1) ??
    url
  )
}

// Makes a show that follows the channel or playlist. Its uploads are
// listed and queued in the background, as the platform may keep us waiting.
export async function createChannelShow(userId: string, input: NewChannelShowInput) {
  const channel = parseChannelUrl(input.url)
  if (channel) return followChannel(userId, channel, input.customDomain, 'channel', input.tags)
  const playlist = parsePlaylistUrl(input.url)
  if (playlist) return followChannel(userId, playlist, input.customDomain, 'playlist', input.tags)
  throw new Error("That isn't a link to a channel or playlist")
}

export async function followChannel(
  userId: string,
  source: { platform: Platform; url: string },
  customDomain?: string | null,
  kind: ChannelKind = 'channel',
  tags?: string[],
) {
  const show = await createShow(userId, { title: nameFromChannelUrl(source.url), customDomain, tags })
  const [channel] = await db
    .insert(channels)
    .values({ showId: show.id, platform: source.platform, kind, url: source.url })
    .returning()
  logger.info({ channelId: channel!.id, showId: show.id, kind, url: source.url }, 'Show is following a channel')
  void checkChannel(channel!.id, { priority: 2 })
  return show
}

// Channels being checked now, so a channel is never checked twice at once.
const checking = new Map<string, Promise<CheckResult>>()

type CheckResult = { added: number } | { error: string }

export function isCheckingChannel(channelId: string) {
  return checking.has(channelId)
}

// Lists the channel's newest uploads and queues the new ones as episodes.
// Resolves when done; errors are noted on the channel rather than thrown.
export function checkChannel(channelId: string, { priority = 0 } = {}) {
  let check = checking.get(channelId)
  if (!check) {
    check = runCheck(channelId, priority).finally(() => checking.delete(channelId))
    checking.set(channelId, check)
  }
  return check
}

async function runCheck(channelId: string, priority: number): Promise<CheckResult> {
  const [row] = await db
    .select({ channel: channels, show: { id: shows.id }, limit: users.channelEpisodeLimit, ownerIsAdmin: users.isAdmin })
    .from(channels)
    .innerJoin(shows, eq(shows.id, channels.showId))
    .innerJoin(users, eq(users.id, shows.userId))
    .where(eq(channels.id, channelId))
    .limit(1)
  if (!row) return { error: 'The channel no longer exists' }
  const { channel, show, ownerIsAdmin } = row
  const playlist = channel.kind === 'playlist'
  const { channelCheckHours } = await getSiteSettings()
  const spread = 1 + checkJitter * (Math.random() * 2 - 1)
  const nextCheckAt = new Date(Date.now() + channelCheckHours * 60 * 60_000 * spread)
  const context = { channelId, showId: show.id, url: channel.url }

  try {
    const first = !channel.lastCheckedAt
    // Admins get everything: a playlist is listed whole every time, as it
    // isn't in upload order; a channel the first time, then just its newest.
    const limit = !ownerIsAdmin ? row.limit : playlist || first ? null : adminRecheckLimit
    if (limit !== null && limit <= 0) throw new Error("Your account can't import episodes from channels")
    const listing = await withDownloadSlot(
      channel.platform as Platform,
      { priority, key: show.id, label: `Listing ${channel.title ?? channel.url}` },
      () => listChannel(channel.platform as Platform, channel.url, limit, { details: first }),
    )
    if (first) await fillInShow(channel, show.id, listing)
    const added = await addNewEntries(channel, show.id, listing.entries, playlist)
    await db
      .update(channels)
      .set({ title: listing.title ?? channel.title, lastCheckedAt: new Date(), nextCheckAt, lastError: null })
      .where(eq(channels.id, channelId))
    logger.info({ ...context, listed: listing.entries.length, added }, 'Channel checked')
    // The first import is the owner's own doing; later uploads are news.
    if (!first) notifyNewEpisodes(show.id, added)
    return { added }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A mistyped or removed channel is the user's to fix; tell them, not us.
    if (error instanceof RateLimitedError) logger.warn({ ...context, err: error }, 'Channel check was refused by the platform')
    else if (/yt-dlp|spawn/i.test(message)) reportError(error, { ...context, msg: 'Channel check failed' })
    else logger.warn({ ...context, err: error }, 'Channel check failed')
    await db
      .update(channels)
      .set({ lastCheckedAt: new Date(), nextCheckAt, lastError: message.slice(0, 1000) })
      .where(eq(channels.id, channelId))
    return { error: message }
  }
}

// The first time a channel is listed, the show takes its name, description
// and artwork, unless the user has given it their own meanwhile (listing can
// take a while, so each is only set if it's still unset).
async function fillInShow(channel: Channel, showId: string, listing: ChannelListing) {
  const ours = eq(shows.id, showId)
  if (listing.title) {
    await db
      .update(shows)
      .set({ title: listing.title.slice(0, 100) })
      .where(and(ours, eq(shows.title, nameFromChannelUrl(channel.url))))
  }
  if (listing.description) {
    await db
      .update(shows)
      .set({ description: plainTextToHtml(listing.description.slice(0, 4000)) })
      .where(and(ours, isNull(shows.description)))
  }
  if (listing.thumbnail) {
    const imageUrl = await downloadImage(listing.thumbnail)
    if (!imageUrl) return
    const [set] = await db
      .update(shows)
      .set({ imageUrl })
      .where(and(ours, isNull(shows.imageUrl)))
      .returning({ id: shows.id })
    if (!set) await deleteImage(imageUrl)
  }
}

// Queues the uploads not seen before as episodes, oldest first. Once the
// channel's been listed, only uploads newer than the newest one seen count as
// new: an older one coming into view (as a newer one is removed) is not.
// A playlist is listed whole and in its own order, so anything not seen
// before is new, wherever it is, and they're queued in the playlist's order.
async function addNewEntries(channel: Channel, showId: string, entries: ChannelEntry[], playlist: boolean) {
  const seen = new Set(
    (await db.select({ key: channelItems.sourceKey }).from(channelItems).where(eq(channelItems.channelId, channel.id))).map(
      (item) => item.key,
    ),
  )
  const newestSeen = playlist ? -1 : entries.findIndex((entry) => seen.has(entry.key))
  const candidates = (newestSeen === -1 ? entries : entries.slice(0, newestSeen)).filter((e) => !seen.has(e.key) && isEpisode(e))
  let added = 0
  for (const entry of playlist ? candidates : candidates.reverse()) {
    const item = and(eq(channelItems.channelId, channel.id), eq(channelItems.sourceKey, entry.key))
    // Claims the upload first, so it can only ever become one episode.
    const [claimed] = await db
      .insert(channelItems)
      .values({ channelId: channel.id, sourceKey: entry.key })
      .onConflictDoNothing()
      .returning()
    if (!claimed) continue
    let episodeId: string
    try {
      const episode = await insertEpisode({
        showId,
        // Without a title, the link stands in until the upload's own is fetched.
        title: entry.title ?? entry.url,
        slug: entry.title ? await availableEpisodeSlug(showId, entry.title) : temporaryEpisodeSlug(),
        sourceUrl: entry.url,
        priority: 0,
      })
      episodeId = episode.id
    } catch (error) {
      // Free to try again at the next check.
      await db.delete(channelItems).where(item)
      throw error
    }
    await db.update(channelItems).set({ episodeId }).where(item)
    added++
    publishEpisodeEvent({ type: 'changed', episodeId })
    enqueueEpisode(episodeId)
  }
  return added
}

// Checks each channel that's due, one after another; for the channel-check job.
export async function checkDueChannels() {
  const due = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.enabled, true), lte(channels.nextCheckAt, new Date())))
    .orderBy(asc(channels.nextCheckAt))
  let added = 0
  let failed = 0
  for (const { id } of due) {
    const result = await checkChannel(id)
    if ('added' in result) added += result.added
    else failed++
  }
  return { checked: due.length, added, failed }
}

// The show's channel, if it follows one and belongs to the user.
async function findOwnedChannel(userId: string, showId: string) {
  const [row] = await db
    .select({ channel: channels })
    .from(channels)
    .innerJoin(shows, eq(shows.id, channels.showId))
    .where(and(eq(channels.showId, showId), eq(shows.userId, userId)))
    .limit(1)
  return row?.channel ?? null
}

// What the show's page shows of the channel it follows, if any.
export async function getShowChannel(showId: string) {
  const [channel] = await db
    .select({
      id: channels.id,
      platform: channels.platform,
      kind: channels.kind,
      url: channels.url,
      title: channels.title,
      enabled: channels.enabled,
      lastCheckedAt: channels.lastCheckedAt,
      nextCheckAt: channels.nextCheckAt,
      lastError: channels.lastError,
    })
    .from(channels)
    .where(eq(channels.showId, showId))
    .limit(1)
  return channel ? { ...channel, checking: isCheckingChannel(channel.id) } : null
}

// The user's "Check now". Null unless the show is theirs and follows a
// channel; 'too-soon' if it was checked in the last few minutes.
export async function checkChannelNow(userId: string, showId: string) {
  const channel = await findOwnedChannel(userId, showId)
  if (!channel) return null
  if (isCheckingChannel(channel.id)) return 'started'
  if (channel.lastCheckedAt && Date.now() - channel.lastCheckedAt.getTime() < manualCheckIntervalMs) return 'too-soon'
  void checkChannel(channel.id, { priority: 1 })
  return 'started'
}

// Pauses or resumes checking. Returns false unless the show is the user's
// and follows a channel.
export async function setChannelEnabled(userId: string, showId: string, enabled: boolean) {
  const channel = await findOwnedChannel(userId, showId)
  if (!channel) return false
  // Resuming checks soon, rather than whenever it was last due.
  const set = enabled ? { enabled, nextCheckAt: new Date() } : { enabled }
  await db.update(channels).set(set).where(eq(channels.id, channel.id))
  return true
}
