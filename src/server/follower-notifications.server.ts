// Telling listeners about the shows they follow: when one goes live, and
// when it has new episodes. Each follower gets a desktop notification
// (push.server.ts), one on the mobile app (app-push.server.ts) and an email
// (notifications.server.ts) for each kind they've chosen, and it goes in their notifications menu (inbox.server.ts)
// either way, unless they've muted the show (show_follow.notify).
// Its owner and private shows are left out.
//
// New episodes are collected per show for a couple of minutes first, so a
// channel's import sends one notification rather than one per episode. Like
// the email batches, what's waiting is kept in memory.
import '@tanstack/react-start/server-only'
import { and, eq, inArray, ne, or } from 'drizzle-orm'
import { episodePath, livePath, showPath } from '~/lib/paths'
import { db } from '~/server/db/client.server'
import { sendAppPush } from '~/server/app-push.server'
import { episodes, showFollows, shows, users } from '~/server/db/schema'
import { isListed } from '~/server/episodes.server'
import { recordNotification } from '~/server/inbox.server'
import { reportError } from '~/server/logger.server'
import { emailFollowedEpisodes, emailFollowerLive } from '~/server/notifications.server'
import { sendPush } from '~/server/push.server'

export const episodeBatchDelayMs = 2 * 60_000
// Episodes dated further back than this (a channel's back catalogue, say)
// aren't news.
export const newEpisodeMaxAgeMs = 7 * 24 * 60 * 60_000

// The followers who haven't muted the show, and which of this kind of
// notification each wants.
async function followers(showId: string, ownerId: string, kind: 'live' | 'episodes') {
  const rows = await db
    .select({
      userId: showFollows.userId,
      push: kind === 'live' ? users.pushLive : users.pushNewEpisodes,
      app: kind === 'live' ? users.appPushLive : users.appPushNewEpisodes,
      email: kind === 'live' ? users.emailLive : users.emailFollowedEpisodes,
    })
    .from(showFollows)
    .innerJoin(users, eq(users.id, showFollows.userId))
    .where(and(eq(showFollows.showId, showId), eq(showFollows.notify, true), ne(showFollows.userId, ownerId)))
  return {
    all: rows.map((row) => row.userId),
    push: rows.filter((row) => row.push).map((row) => row.userId),
    app: rows.filter((row) => row.app).map((row) => row.userId),
    email: rows.filter((row) => row.email).map((row) => row.userId),
  }
}

// Notifications never get in the way of what they're about.
const safely = (work: Promise<void>) =>
  void work.catch((error: unknown) => reportError(error, { msg: 'Notifying followers failed' }))

export function notifyFollowersLive(showId: string, broadcastTitle: string) {
  safely(
    (async () => {
      const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1)
      if (!show || show.private) return
      const to = await followers(showId, show.userId, 'live')
      const message = {
        title: `${show.title} is live`,
        body: broadcastTitle,
        url: livePath(show.slug),
        icon: show.imageUrl,
        tag: `live-${showId}`,
      }
      await recordNotification(to.all, { kind: 'live', ...message, image: message.icon })
      for (const userId of to.email) emailFollowerLive(userId, show, broadcastTitle)
      await Promise.all([
        sendPush(to.push, message),
        sendAppPush(to.app, { title: message.title, body: message.body, path: `/live/${show.slug}`, channel: 'live' }),
      ])
    })(),
  )
}

const waiting = new Map<string, Set<string>>()

// For an episode that has just become ready: tells its show's followers,
// with any others from the show in the next couple of minutes.
export function notifyFollowersNewEpisode(episodeId: string, showId: string, publishedAt: Date | null, now = new Date()) {
  if (publishedAt && now.getTime() - publishedAt.getTime() > newEpisodeMaxAgeMs) return
  const batch = waiting.get(showId)
  if (batch) {
    batch.add(episodeId)
    return
  }
  waiting.set(showId, new Set([episodeId]))
  setTimeout(() => safely(flushEpisodes(showId)), episodeBatchDelayMs).unref?.()
}

async function flushEpisodes(showId: string) {
  const ids = waiting.get(showId)
  waiting.delete(showId)
  if (!ids?.size) return
  const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1)
  if (!show || show.private) return
  // As they are now: any made private or deleted meanwhile are left out.
  const ready = await db
    .select({ id: episodes.id, title: episodes.title, slug: episodes.slug, imageUrl: episodes.imageUrl })
    .from(episodes)
    .where(and(inArray(episodes.id, [...ids]), isListed))
  if (!ready.length) return
  const to = await followers(showId, show.userId, 'episodes')
  for (const userId of to.email) emailFollowedEpisodes(userId, show, ready)
  const [first] = ready
  const message =
    ready.length === 1
      ? {
          title: `New from ${show.title}`,
          body: first!.title,
          url: episodePath(show.slug, first!.slug),
          icon: first!.imageUrl ?? show.imageUrl,
          tag: `episodes-${showId}`,
        }
      : {
          title: `${ready.length} new episodes from ${show.title}`,
          body: ready.map((episode) => episode.title).join(' · '),
          url: showPath(show.slug),
          icon: show.imageUrl,
          tag: `episodes-${showId}`,
        }
  await recordNotification(to.all, { kind: 'followedEpisodes', ...message, image: message.icon })
  await Promise.all([
    sendPush(to.push, message),
    sendAppPush(to.app, {
      title: message.title,
      body: message.body,
      path: ready.length === 1 ? `/episodes/${first!.id}` : `/shows/${show.slug}`,
      channel: 'episodes',
    }),
  ])
}

// For tests: sends every waiting batch now.
export async function flushAllFollowerNotifications() {
  await Promise.all([...waiting.keys()].map(flushEpisodes))
}

// The shows the user follows, for choosing which they hear about: public
// ones, and their own, as for following.
export async function listFollowNotify(userId: string) {
  return db
    .select({
      showId: shows.id,
      title: shows.title,
      slug: shows.slug,
      imageUrl: shows.imageUrl,
      notify: showFollows.notify,
    })
    .from(showFollows)
    .innerJoin(shows, eq(shows.id, showFollows.showId))
    .where(and(eq(showFollows.userId, userId), or(eq(shows.private, false), eq(shows.userId, userId))))
    .orderBy(shows.title)
}

// Mutes or unmutes a show the user follows. Returns whether they follow it.
export async function setFollowNotify(userId: string, showId: string, notify: boolean) {
  const updated = await db
    .update(showFollows)
    .set({ notify })
    .where(and(eq(showFollows.userId, userId), eq(showFollows.showId, showId)))
    .returning({ showId: showFollows.showId })
  return updated.length > 0
}
