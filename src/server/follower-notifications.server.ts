// Telling listeners about the podcasts they follow: when one goes live, and
// when it has new episodes. Each follower gets a desktop notification
// (push.server.ts) and an email (notifications.server.ts) for each kind
// they've chosen, unless they've muted the podcast (podcast_follow.notify).
// Its owner and private podcasts are left out.
//
// New episodes are collected per podcast for a couple of minutes first, so a
// channel's import sends one notification rather than one per episode. Like
// the email batches, what's waiting is kept in memory.
import '@tanstack/react-start/server-only'
import { and, eq, inArray, ne, or } from 'drizzle-orm'
import { episodePath, livePath, podcastPath } from '~/lib/paths'
import { db } from '~/server/db/client.server'
import { episodes, podcastFollows, podcasts, users } from '~/server/db/schema'
import { isListed } from '~/server/episodes.server'
import { reportError } from '~/server/logger.server'
import { emailFollowedEpisodes, emailFollowerLive } from '~/server/notifications.server'
import { sendPush } from '~/server/push.server'

export const episodeBatchDelayMs = 2 * 60_000
// Episodes dated further back than this (a channel's back catalogue, say)
// aren't news.
export const newEpisodeMaxAgeMs = 7 * 24 * 60 * 60_000

// The followers who haven't muted the podcast, and which of this kind of
// notification each wants.
async function followers(podcastId: string, ownerId: string, kind: 'live' | 'episodes') {
  const rows = await db
    .select({
      userId: podcastFollows.userId,
      push: kind === 'live' ? users.pushLive : users.pushNewEpisodes,
      email: kind === 'live' ? users.emailLive : users.emailFollowedEpisodes,
    })
    .from(podcastFollows)
    .innerJoin(users, eq(users.id, podcastFollows.userId))
    .where(and(eq(podcastFollows.podcastId, podcastId), eq(podcastFollows.notify, true), ne(podcastFollows.userId, ownerId)))
  return {
    push: rows.filter((row) => row.push).map((row) => row.userId),
    email: rows.filter((row) => row.email).map((row) => row.userId),
  }
}

// Notifications never get in the way of what they're about.
const safely = (work: Promise<void>) =>
  void work.catch((error: unknown) => reportError(error, { msg: 'Notifying followers failed' }))

export function notifyFollowersLive(podcastId: string, broadcastTitle: string) {
  safely(
    (async () => {
      const [podcast] = await db.select().from(podcasts).where(eq(podcasts.id, podcastId)).limit(1)
      if (!podcast || podcast.private) return
      const to = await followers(podcastId, podcast.userId, 'live')
      for (const userId of to.email) emailFollowerLive(userId, podcast, broadcastTitle)
      await sendPush(to.push, {
        title: `${podcast.title} is live`,
        body: broadcastTitle,
        url: livePath(podcast.slug),
        icon: podcast.imageUrl,
        tag: `live-${podcastId}`,
      })
    })(),
  )
}

const waiting = new Map<string, Set<string>>()

// For an episode that has just become ready: tells its podcast's followers,
// with any others from the podcast in the next couple of minutes.
export function notifyFollowersNewEpisode(episodeId: string, podcastId: string, publishedAt: Date | null, now = new Date()) {
  if (publishedAt && now.getTime() - publishedAt.getTime() > newEpisodeMaxAgeMs) return
  const batch = waiting.get(podcastId)
  if (batch) {
    batch.add(episodeId)
    return
  }
  waiting.set(podcastId, new Set([episodeId]))
  setTimeout(() => safely(flushEpisodes(podcastId)), episodeBatchDelayMs).unref?.()
}

async function flushEpisodes(podcastId: string) {
  const ids = waiting.get(podcastId)
  waiting.delete(podcastId)
  if (!ids?.size) return
  const [podcast] = await db.select().from(podcasts).where(eq(podcasts.id, podcastId)).limit(1)
  if (!podcast || podcast.private) return
  // As they are now: any made private or deleted meanwhile are left out.
  const ready = await db
    .select({ title: episodes.title, slug: episodes.slug, imageUrl: episodes.imageUrl })
    .from(episodes)
    .where(and(inArray(episodes.id, [...ids]), isListed))
  if (!ready.length) return
  const to = await followers(podcastId, podcast.userId, 'episodes')
  for (const userId of to.email) emailFollowedEpisodes(userId, podcast, ready)
  const [first] = ready
  await sendPush(
    to.push,
    ready.length === 1
      ? {
          title: `New from ${podcast.title}`,
          body: first!.title,
          url: episodePath(podcast.slug, first!.slug),
          icon: first!.imageUrl ?? podcast.imageUrl,
          tag: `episodes-${podcastId}`,
        }
      : {
          title: `${ready.length} new episodes from ${podcast.title}`,
          body: ready.map((episode) => episode.title).join(' · '),
          url: podcastPath(podcast.slug),
          icon: podcast.imageUrl,
          tag: `episodes-${podcastId}`,
        },
  )
}

// For tests: sends every waiting batch now.
export async function flushAllFollowerNotifications() {
  await Promise.all([...waiting.keys()].map(flushEpisodes))
}

// The podcasts the user follows, for choosing which they hear about: public
// ones, and their own, as for following.
export async function listFollowNotify(userId: string) {
  return db
    .select({
      podcastId: podcasts.id,
      title: podcasts.title,
      slug: podcasts.slug,
      imageUrl: podcasts.imageUrl,
      notify: podcastFollows.notify,
    })
    .from(podcastFollows)
    .innerJoin(podcasts, eq(podcasts.id, podcastFollows.podcastId))
    .where(and(eq(podcastFollows.userId, userId), or(eq(podcasts.private, false), eq(podcasts.userId, userId))))
    .orderBy(podcasts.title)
}

// Mutes or unmutes a podcast the user follows. Returns whether they follow it.
export async function setFollowNotify(userId: string, podcastId: string, notify: boolean) {
  const updated = await db
    .update(podcastFollows)
    .set({ notify })
    .where(and(eq(podcastFollows.userId, userId), eq(podcastFollows.podcastId, podcastId)))
    .returning({ podcastId: podcastFollows.podcastId })
  return updated.length > 0
}
