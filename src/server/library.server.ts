// What listeners do on the site besides listening: liking episodes and
// following podcasts. Also the lists built from those (Likes, Following,
// Continue listening) and from the site's public podcasts (Explore). Private
// podcasts and episodes only ever show up for their owner (see visibleTo).
import '@tanstack/react-start/server-only'
import { and, count, desc, eq, gt, isNull, lt, max, or, sql } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodeLikes, episodes, playbackPositions, podcastFollows, podcasts, users } from '~/server/db/schema'
import {
  isListed,
  likeCount,
  listenerEpisodeColumns,
  listenerPosition,
  newestPublishedFirst,
  visibleTo,
  type Page,
} from '~/server/episodes.server'
import { podcastArtwork, podcastAuthor, podcastFollowColumns } from '~/server/podcasts.server'

// The podcast an episode in a list across podcasts belongs to.
const episodePodcastColumns = {
  podcast: {
    slug: podcasts.slug,
    title: podcasts.title,
    imageUrl: podcasts.imageUrl,
    userId: podcasts.userId,
  },
}

// Episodes from any podcasts, as the listener sees them. Callers add their
// own joins, conditions and order.
function listenerEpisodes(listenerId: string | null) {
  return db
    .select({ ...listenerEpisodeColumns(listenerId), ...episodePodcastColumns })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .leftJoin(playbackPositions, listenerPosition(listenerId))
    .$dynamic()
}

// Whether the listener owns each episode's podcast (so its player shows the
// owner's controls), without handing out owners' ids.
function withOwnership<T extends { podcast: { userId: string } }>(rows: T[], listenerId: string | null) {
  return rows.map(({ podcast: { userId, ...podcast }, ...episode }) => ({
    ...episode,
    podcast: { ...(podcast as Omit<T['podcast'], 'userId'>), isOwner: userId === listenerId },
  }))
}

export type ListenerEpisode = Awaited<ReturnType<typeof listLikedEpisodes>>[number]

// --- Likes --------------------------------------------------------------------

// Likes or unlikes an episode the user can see. Returns whether they like it
// now and how many do, or null if there's no such episode for them.
export async function setEpisodeLike(userId: string, episodeId: string, liked: boolean) {
  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(episodes.id, episodeId), visibleTo(userId)))
    .limit(1)
  if (!episode) return null
  if (liked) await db.insert(episodeLikes).values({ userId, episodeId }).onConflictDoNothing()
  else await db.delete(episodeLikes).where(and(eq(episodeLikes.userId, userId), eq(episodeLikes.episodeId, episodeId)))
  const [{ likes }] = (await db
    .select({ likes: count() })
    .from(episodeLikes)
    .where(eq(episodeLikes.episodeId, episodeId))) as [{ likes: number }]
  return { liked, likeCount: likes }
}

// The episodes the user likes, most recently liked first. Ones that have since
// been made private (by someone else) are left out.
export async function listLikedEpisodes(userId: string, page: Page) {
  const rows = await listenerEpisodes(userId)
    .innerJoin(episodeLikes, and(eq(episodeLikes.episodeId, episodes.id), eq(episodeLikes.userId, userId)))
    .where(visibleTo(userId))
    .orderBy(desc(episodeLikes.createdAt), desc(episodes.id))
    .offset(page.offset)
    .limit(page.limit)
  return withOwnership(rows, userId)
}

export async function countLikedEpisodes(userId: string) {
  const [row] = await db
    .select({ count: count() })
    .from(episodeLikes)
    .innerJoin(episodes, eq(episodes.id, episodeLikes.episodeId))
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(episodeLikes.userId, userId), visibleTo(userId)))
  return row!.count
}

// --- Follows ------------------------------------------------------------------

// Podcasts the user may follow: public ones, and their own.
function followable(userId: string) {
  return or(eq(podcasts.private, false), eq(podcasts.userId, userId))
}

// Follows or unfollows a podcast. Returns whether the user follows it now and
// how many do, or null if there's no such podcast for them.
export async function setPodcastFollow(userId: string, podcastId: string, following: boolean) {
  const [podcast] = await db
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(and(eq(podcasts.id, podcastId), followable(userId)))
    .limit(1)
  if (!podcast) return null
  if (following) await db.insert(podcastFollows).values({ userId, podcastId }).onConflictDoNothing()
  else await db.delete(podcastFollows).where(and(eq(podcastFollows.userId, userId), eq(podcastFollows.podcastId, podcastId)))
  return { following, followerCount: await countFollowers(podcastId) }
}

export async function countFollowers(podcastId: string) {
  const [row] = await db.select({ count: count() }).from(podcastFollows).where(eq(podcastFollows.podcastId, podcastId))
  return row!.count
}

// A podcast as a card in a grid: its artwork, who makes it, its listed
// episodes and when the latest came out, and its followers. Only podcasts
// with at least one listed episode, unless `includeEmpty`.
function podcastCards(viewerId: string | null, { includeEmpty = false } = {}) {
  const latestAt = max(sql`coalesce(${episodes.publishedAt}, ${episodes.createdAt})`).mapWith(episodes.createdAt)
  const join = and(eq(episodes.podcastId, podcasts.id), isListed)
  const query = db
    .select({
      id: podcasts.id,
      title: podcasts.title,
      slug: podcasts.slug,
      imageUrl: podcastArtwork,
      author: podcastAuthor,
      episodeCount: count(episodes.id),
      latestAt,
      ...podcastFollowColumns(viewerId),
    })
    .from(podcasts)
    .innerJoin(users, eq(users.id, podcasts.userId))
  return {
    query: (includeEmpty ? query.leftJoin(episodes, join) : query.innerJoin(episodes, join)).$dynamic(),
    latestAt,
  }
}

// The podcasts the user follows, by title, for the sidebar and Following
// page. Ones made private since are left out.
export function listFollowedPodcasts(userId: string) {
  const { query } = podcastCards(userId, { includeEmpty: true })
  return query
    .innerJoin(podcastFollows, and(eq(podcastFollows.podcastId, podcasts.id), eq(podcastFollows.userId, userId)))
    .where(followable(userId))
    .groupBy(podcasts.id, users.id)
    .orderBy(podcasts.title)
}

// New episodes from the podcasts the user follows, newest first.
export async function listFollowingEpisodes(userId: string, page: Page) {
  const rows = await listenerEpisodes(userId)
    .innerJoin(podcastFollows, and(eq(podcastFollows.podcastId, podcasts.id), eq(podcastFollows.userId, userId)))
    .where(and(visibleTo(userId), isListed))
    .orderBy(newestPublishedFirst, desc(episodes.id))
    .offset(page.offset)
    .limit(page.limit)
  return withOwnership(rows, userId)
}

// --- Continue listening -------------------------------------------------------

// How close to the end counts as finished.
const finishedWithinSeconds = 30

// Episodes the user started and hasn't finished, most recently played first.
export async function listContinueListening(userId: string, limit = 8) {
  const rows = await listenerEpisodes(userId)
    .where(
      and(
        visibleTo(userId),
        gt(playbackPositions.positionSeconds, 0),
        or(
          isNull(episodes.durationSeconds),
          lt(playbackPositions.positionSeconds, sql`${episodes.durationSeconds} - ${finishedWithinSeconds}`),
        ),
      ),
    )
    .orderBy(desc(playbackPositions.updatedAt))
    .limit(limit)
  return withOwnership(rows, userId)
}

// --- Explore ------------------------------------------------------------------

const anyone = and(eq(podcasts.private, false), isListed)

// Public podcasts with episodes, the most recently updated first.
export function listExplorePodcasts(viewerId: string | null, page: Page) {
  const { query, latestAt } = podcastCards(viewerId)
  return query
    .where(eq(podcasts.private, false))
    .groupBy(podcasts.id, users.id)
    .orderBy(desc(latestAt), desc(podcasts.id))
    .offset(page.offset)
    .limit(page.limit)
}

export async function countExplorePodcasts() {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${podcasts.id})`.mapWith(Number) })
    .from(podcasts)
    .innerJoin(episodes, eq(episodes.podcastId, podcasts.id))
    .where(anyone)
  return row!.count
}

// The newest public episodes across the site.
export async function listLatestEpisodes(viewerId: string | null, page: Page) {
  const rows = await listenerEpisodes(viewerId)
    .where(anyone)
    .orderBy(newestPublishedFirst, desc(episodes.id))
    .offset(page.offset)
    .limit(page.limit)
  return withOwnership(rows, viewerId)
}

// How far back likes count towards an episode being popular.
export const popularDays = 30

// The public episodes most liked in the last month, most liked first.
export async function listPopularEpisodes(viewerId: string | null, limit = 6) {
  const since = new Date(Date.now() - popularDays * 24 * 60 * 60 * 1000)
  const recentLikes = sql<number>`(
    select count(*) from ${episodeLikes}
    where ${episodeLikes.episodeId} = ${episodes.id} and ${episodeLikes.createdAt} > ${since.toISOString()}
  )`
  const rows = await listenerEpisodes(viewerId)
    .where(and(anyone, gt(recentLikes, 0)))
    .orderBy(desc(recentLikes), desc(likeCount), newestPublishedFirst)
    .limit(limit)
  return withOwnership(rows, viewerId)
}
