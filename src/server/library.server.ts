// What listeners do on the site besides listening: liking episodes and
// following shows. Also the lists built from those (Likes, Following,
// Continue listening) and from the site's public shows (Explore). Private
// shows and episodes only ever show up for their owner (see visibleTo).
import '@tanstack/react-start/server-only'
import { and, count, desc, eq, gt, isNull, lt, max, ne, or, sql } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodeActivity, episodeLikes, episodes, playbackPositions, showFollows, shows, users } from '~/server/db/schema'
import {
  isListed,
  likeCount,
  listenerEpisodeColumns,
  listenerPosition,
  newestPublishedFirst,
  visibleTo,
  type Page,
} from '~/server/episodes.server'
import { showArtwork, showAuthor, showFollowColumns } from '~/server/shows.server'

// The show an episode in a list across shows belongs to.
const episodeShowColumns = {
  show: {
    slug: shows.slug,
    title: shows.title,
    imageUrl: shows.imageUrl,
    userId: shows.userId,
  },
}

// Episodes from any shows, as the listener sees them. Callers add their
// own joins, conditions and order. Playlists use these too.
export function listenerEpisodes(listenerId: string | null) {
  return db
    .select({ ...listenerEpisodeColumns(listenerId), ...episodeShowColumns })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .leftJoin(playbackPositions, listenerPosition(listenerId))
    .$dynamic()
}

// Whether the listener owns each episode's show (so its player shows the
// owner's controls), without handing out owners' ids.
export function withOwnership<T extends { show: { userId: string } }>(rows: T[], listenerId: string | null) {
  return rows.map(({ show: { userId, ...show }, ...episode }) => ({
    ...episode,
    show: { ...(show as Omit<T['show'], 'userId'>), isOwner: userId === listenerId },
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
    .innerJoin(shows, eq(shows.id, episodes.showId))
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
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(and(eq(episodeLikes.userId, userId), visibleTo(userId)))
  return row!.count
}

// --- Follows ------------------------------------------------------------------

// Shows the user may follow: public ones, and their own.
function followable(userId: string) {
  return or(eq(shows.private, false), eq(shows.userId, userId))
}

// Follows or unfollows a show. Returns whether the user follows it now and
// how many do, or null if there's no such show for them.
export async function setShowFollow(userId: string, showId: string, following: boolean) {
  const [show] = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.id, showId), followable(userId)))
    .limit(1)
  if (!show) return null
  if (following) await db.insert(showFollows).values({ userId, showId }).onConflictDoNothing()
  else await db.delete(showFollows).where(and(eq(showFollows.userId, userId), eq(showFollows.showId, showId)))
  return { following, followerCount: await countFollowers(showId) }
}

export async function countFollowers(showId: string) {
  const [row] = await db.select({ count: count() }).from(showFollows).where(eq(showFollows.showId, showId))
  return row!.count
}

// A show as a card in a grid: its artwork, who makes it, its listed
// episodes and when the latest came out, and its followers. Only shows
// with at least one listed episode, unless `includeEmpty`.
function showCards(viewerId: string | null, { includeEmpty = false } = {}) {
  const latestAt = max(sql`coalesce(${episodes.publishedAt}, ${episodes.createdAt})`).mapWith(episodes.createdAt)
  const join = and(eq(episodes.showId, shows.id), isListed)
  const query = db
    .select({
      id: shows.id,
      title: shows.title,
      slug: shows.slug,
      imageUrl: showArtwork,
      author: showAuthor,
      episodeCount: count(episodes.id),
      latestAt,
      ...showFollowColumns(viewerId),
    })
    .from(shows)
    .innerJoin(users, eq(users.id, shows.userId))
  return {
    query: (includeEmpty ? query.leftJoin(episodes, join) : query.innerJoin(episodes, join)).$dynamic(),
    latestAt,
  }
}

// The shows the user follows, by title, for the sidebar and Following
// page. Ones made private since are left out.
export function listFollowedShows(userId: string) {
  const { query } = showCards(userId, { includeEmpty: true })
  return query
    .innerJoin(showFollows, and(eq(showFollows.showId, shows.id), eq(showFollows.userId, userId)))
    .where(followable(userId))
    .groupBy(shows.id, users.id)
    .orderBy(shows.title)
}

// New episodes from the shows the user follows, newest first.
export async function listFollowingEpisodes(userId: string, page: Page) {
  const rows = await listenerEpisodes(userId)
    .innerJoin(showFollows, and(eq(showFollows.showId, shows.id), eq(showFollows.userId, userId)))
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

const anyone = and(eq(shows.private, false), isListed)

// Public shows with episodes, the most recently updated first.
export function listExploreShows(viewerId: string | null, page: Page) {
  const { query, latestAt } = showCards(viewerId)
  return query
    .where(eq(shows.private, false))
    .groupBy(shows.id, users.id)
    .orderBy(desc(latestAt), desc(shows.id))
    .offset(page.offset)
    .limit(page.limit)
}

// A user's public shows, for their profile page, newest episodes first.
export function listUserShows(viewerId: string | null, ownerId: string) {
  const { query, latestAt } = showCards(viewerId)
  return query
    .where(and(eq(shows.private, false), eq(shows.userId, ownerId)))
    .groupBy(shows.id, users.id)
    .orderBy(desc(latestAt), desc(shows.id))
}

export async function countExploreShows() {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${shows.id})`.mapWith(Number) })
    .from(shows)
    .innerJoin(episodes, eq(episodes.showId, shows.id))
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

// How much a like or a new follower counts towards a show trending, against
// a play: each is rarer, and someone saying they want more.
const trendingLikeWeight = 5
const trendingFollowWeight = 5

// Public shows for the viewer to discover, leaving out their own and those they
// follow: the most played, liked and followed in the last month first, then
// (so a quiet site still has something to offer) the most recently updated.
export function listTrendingShows(viewerId: string, limit = 10) {
  const since = new Date(Date.now() - popularDays * 24 * 60 * 60 * 1000).toISOString()
  const plays = sql`(
    select count(*) from ${episodeActivity}
    where ${episodeActivity.showId} = ${shows.id} and ${episodeActivity.type} = 'play' and ${episodeActivity.occurredAt} > ${since}
  )`
  const likes = sql`(
    select count(*) from ${episodeLikes}
    inner join ${episodes} on ${episodes.id} = ${episodeLikes.episodeId}
    where ${episodes.showId} = ${shows.id} and ${isListed} and ${episodeLikes.createdAt} > ${since}
  )`
  const follows = sql`(
    select count(*) from ${showFollows}
    where ${showFollows.showId} = ${shows.id} and ${showFollows.createdAt} > ${since}
  )`
  const { query, latestAt } = showCards(viewerId)
  return query
    .where(
      and(
        eq(shows.private, false),
        ne(shows.userId, viewerId),
        sql`not exists (
          select 1 from ${showFollows} where ${showFollows.showId} = ${shows.id} and ${showFollows.userId} = ${viewerId}
        )`,
      ),
    )
    .groupBy(shows.id, users.id)
    .orderBy(
      desc(sql`${plays} + ${trendingLikeWeight} * ${likes} + ${trendingFollowWeight} * ${follows}`),
      desc(latestAt),
      desc(shows.id),
    )
    .limit(limit)
}
