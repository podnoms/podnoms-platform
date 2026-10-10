// Podcasts that follow a channel (a YouTube channel, a Mixcloud user…): the
// channel's newest uploads become episodes, and it's checked now and then
// for new ones (the channel-check job, see jobs.server.ts).
//
// Listing a channel (see channel-listing.server.ts) asks the platform for just
// its newest uploads, through the download throttle like the downloads.
import '@tanstack/react-start/server-only'
import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import type { NewChannelPodcastInput } from '~/lib/channel-schema'
import { parseChannelUrl, type Platform } from '~/lib/platforms'
import { plainTextToHtml } from '~/lib/rich-text'
import { db } from '~/server/db/client.server'
import { channelItems, channels, podcasts, users, type Channel } from '~/server/db/schema'
import { RateLimitedError, withDownloadSlot } from '~/server/download-throttle.server'
import { publishEpisodeEvent } from '~/server/episode-events.server'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { availableEpisodeSlug, temporaryEpisodeSlug } from '~/server/episode-slugs.server'
import { insertEpisode } from '~/server/episodes.server'
import { deleteImage, downloadImage } from '~/server/images.server'
import { logger, reportError } from '~/server/logger.server'
import { notifyNewEpisodes } from '~/server/notifications.server'
import { createPodcast } from '~/server/podcasts.server'
import { listChannel, type ChannelEntry, type ChannelListing } from '~/server/channel-listing.server'
import { getSiteSettings } from '~/server/site-settings.server'

// Users can ask for a check this often at most.
export const manualCheckIntervalMs = 15 * 60_000
// Scheduled checks are spread out by this much either way.
const checkJitter = 0.1
// Uploads shorter than this are Shorts or trailers, not episodes.
const minDurationSeconds = 60

// Uploads worth making episodes of.
const isEpisode = (entry: ChannelEntry) =>
  !entry.live && (entry.durationSeconds == null || entry.durationSeconds >= minDurationSeconds)

// A name for the channel from its link, e.g. "@someone", until its own title is known.
export function nameFromChannelUrl(url: string) {
  const parts = new URL(url).pathname.split('/').filter(Boolean)
  return parts.find((part) => !['channel', 'c', 'user', 'videos', 'uploads'].includes(part)) ?? url
}

// Makes a podcast that follows the channel. Its uploads are listed and
// queued in the background, as the platform may keep us waiting.
export async function createChannelPodcast(userId: string, input: NewChannelPodcastInput) {
  const source = parseChannelUrl(input.url)
  if (!source) throw new Error("That isn't a link to a channel")
  return followChannel(userId, source, input.customDomain)
}

export async function followChannel(
  userId: string,
  source: { platform: Platform; url: string },
  customDomain?: string | null,
) {
  const podcast = await createPodcast(userId, { title: nameFromChannelUrl(source.url), customDomain })
  const [channel] = await db
    .insert(channels)
    .values({ podcastId: podcast.id, platform: source.platform, url: source.url })
    .returning()
  logger.info({ channelId: channel!.id, podcastId: podcast.id, url: source.url }, 'Podcast is following a channel')
  void checkChannel(channel!.id, { priority: 2 })
  return podcast
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
    .select({ channel: channels, podcast: { id: podcasts.id }, limit: users.channelEpisodeLimit })
    .from(channels)
    .innerJoin(podcasts, eq(podcasts.id, channels.podcastId))
    .innerJoin(users, eq(users.id, podcasts.userId))
    .where(eq(channels.id, channelId))
    .limit(1)
  if (!row) return { error: 'The channel no longer exists' }
  const { channel, podcast, limit } = row
  const { channelCheckHours } = await getSiteSettings()
  const spread = 1 + checkJitter * (Math.random() * 2 - 1)
  const nextCheckAt = new Date(Date.now() + channelCheckHours * 60 * 60_000 * spread)
  const context = { channelId, podcastId: podcast.id, url: channel.url }

  try {
    if (limit <= 0) throw new Error("Your account can't import episodes from channels")
    const first = !channel.lastCheckedAt
    const listing = await withDownloadSlot(
      channel.platform as Platform,
      { priority, key: podcast.id, label: `Listing ${channel.title ?? channel.url}` },
      () => listChannel(channel.platform as Platform, channel.url, limit, { details: first }),
    )
    if (first) await fillInPodcast(channel, podcast.id, listing)
    const added = await addNewEntries(channel, podcast.id, listing.entries)
    await db
      .update(channels)
      .set({ title: listing.title ?? channel.title, lastCheckedAt: new Date(), nextCheckAt, lastError: null })
      .where(eq(channels.id, channelId))
    logger.info({ ...context, listed: listing.entries.length, added }, 'Channel checked')
    // The first import is the owner's own doing; later uploads are news.
    if (!first) notifyNewEpisodes(podcast.id, added)
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

// The first time a channel is listed, the podcast takes its name, description
// and artwork, unless the user has given it their own meanwhile (listing can
// take a while, so each is only set if it's still unset).
async function fillInPodcast(channel: Channel, podcastId: string, listing: ChannelListing) {
  const ours = eq(podcasts.id, podcastId)
  if (listing.title) {
    await db
      .update(podcasts)
      .set({ title: listing.title.slice(0, 100) })
      .where(and(ours, eq(podcasts.title, nameFromChannelUrl(channel.url))))
  }
  if (listing.description) {
    await db
      .update(podcasts)
      .set({ description: plainTextToHtml(listing.description.slice(0, 4000)) })
      .where(and(ours, isNull(podcasts.description)))
  }
  if (listing.thumbnail) {
    const imageUrl = await downloadImage(listing.thumbnail)
    if (!imageUrl) return
    const [set] = await db
      .update(podcasts)
      .set({ imageUrl })
      .where(and(ours, isNull(podcasts.imageUrl)))
      .returning({ id: podcasts.id })
    if (!set) await deleteImage(imageUrl)
  }
}

// Queues the uploads not seen before as episodes, oldest first. Once the
// channel's been listed, only uploads newer than the newest one seen count as
// new: an older one coming into view (as a newer one is removed) is not.
async function addNewEntries(channel: Channel, podcastId: string, entries: ChannelEntry[]) {
  const seen = new Set(
    (await db.select({ key: channelItems.sourceKey }).from(channelItems).where(eq(channelItems.channelId, channel.id))).map(
      (item) => item.key,
    ),
  )
  const newestSeen = entries.findIndex((entry) => seen.has(entry.key))
  const candidates = newestSeen === -1 ? entries : entries.slice(0, newestSeen)
  let added = 0
  for (const entry of candidates.filter((e) => !seen.has(e.key) && isEpisode(e)).reverse()) {
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
        podcastId,
        // Without a title, the link stands in until the upload's own is fetched.
        title: entry.title ?? entry.url,
        slug: entry.title ? await availableEpisodeSlug(podcastId, entry.title) : temporaryEpisodeSlug(),
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

// The podcast's channel, if it follows one and belongs to the user.
async function findOwnedChannel(userId: string, podcastId: string) {
  const [row] = await db
    .select({ channel: channels })
    .from(channels)
    .innerJoin(podcasts, eq(podcasts.id, channels.podcastId))
    .where(and(eq(channels.podcastId, podcastId), eq(podcasts.userId, userId)))
    .limit(1)
  return row?.channel ?? null
}

// What the podcast's page shows of the channel it follows, if any.
export async function getPodcastChannel(podcastId: string) {
  const [channel] = await db
    .select({
      id: channels.id,
      platform: channels.platform,
      url: channels.url,
      title: channels.title,
      enabled: channels.enabled,
      lastCheckedAt: channels.lastCheckedAt,
      nextCheckAt: channels.nextCheckAt,
      lastError: channels.lastError,
    })
    .from(channels)
    .where(eq(channels.podcastId, podcastId))
    .limit(1)
  return channel ? { ...channel, checking: isCheckingChannel(channel.id) } : null
}

// The user's "Check now". Null unless the podcast is theirs and follows a
// channel; 'too-soon' if it was checked in the last few minutes.
export async function checkChannelNow(userId: string, podcastId: string) {
  const channel = await findOwnedChannel(userId, podcastId)
  if (!channel) return null
  if (isCheckingChannel(channel.id)) return 'started'
  if (channel.lastCheckedAt && Date.now() - channel.lastCheckedAt.getTime() < manualCheckIntervalMs) return 'too-soon'
  void checkChannel(channel.id, { priority: 1 })
  return 'started'
}

// Pauses or resumes checking. Returns false unless the podcast is the user's
// and follows a channel.
export async function setChannelEnabled(userId: string, podcastId: string, enabled: boolean) {
  const channel = await findOwnedChannel(userId, podcastId)
  if (!channel) return false
  // Resuming checks soon, rather than whenever it was last due.
  const set = enabled ? { enabled, nextCheckAt: new Date() } : { enabled }
  await db.update(channels).set(set).where(eq(channels.id, channel.id))
  return true
}
