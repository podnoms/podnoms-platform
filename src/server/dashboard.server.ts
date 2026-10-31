// The signed-in home page: how a user's shows are doing, across all of them.
import '@tanstack/react-start/server-only'
import { and, count, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm'
import { activityInScope, activityPeriod, summariseActivity } from '~/server/activity.server'
import { db } from '~/server/db/client.server'
import { episodeActivity, episodes, shows } from '~/server/db/schema'

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>

export async function getDashboard(userId: string, days: number, now = new Date()) {
  const { start } = activityPeriod(days, now)
  const previousStart = new Date(start.getTime() - days * 86_400_000)
  const inPeriod = and(activityInScope({ userId }), gte(episodeActivity.occurredAt, start))

  const [activity, previous, showCount, episodeCounts, topEpisodes, recentEpisodes, countries] = await Promise.all([
    summariseActivity({ userId, days, now }),
    // The period before, to compare against.
    db
      .select({ type: episodeActivity.type, count: count() })
      .from(episodeActivity)
      .where(
        and(
          activityInScope({ userId }),
          gte(episodeActivity.occurredAt, previousStart),
          lt(episodeActivity.occurredAt, start),
        ),
      )
      .groupBy(episodeActivity.type),
    db.$count(shows, eq(shows.userId, userId)),
    db
      .select({ status: episodes.status, count: count(), seconds: sql<number>`coalesce(sum(${episodes.durationSeconds}), 0)`.mapWith(Number) })
      .from(episodes)
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .where(eq(shows.userId, userId))
      .groupBy(episodes.status),
    db
      .select({
        id: episodes.id,
        title: episodes.title,
        slug: episodes.slug,
        imageUrl: sql<string | null>`coalesce(${episodes.imageUrl}, ${shows.imageUrl})`,
        showTitle: shows.title,
        showSlug: shows.slug,
        plays: sql<number>`count(*) filter (where ${episodeActivity.type} = 'play')`.mapWith(Number),
        downloads: sql<number>`count(*) filter (where ${episodeActivity.type} = 'download')`.mapWith(Number),
      })
      .from(episodeActivity)
      .innerJoin(episodes, eq(episodes.id, episodeActivity.episodeId))
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .where(and(inPeriod, sql`${episodeActivity.type} <> 'share'`))
      .groupBy(episodes.id, shows.id)
      .orderBy(desc(count()), episodes.title)
      .limit(5),
    db
      .select({
        id: episodes.id,
        title: episodes.title,
        slug: episodes.slug,
        status: episodes.status,
        imageUrl: sql<string | null>`coalesce(${episodes.imageUrl}, ${shows.imageUrl})`,
        durationSeconds: episodes.durationSeconds,
        createdAt: episodes.createdAt,
        showTitle: shows.title,
        showSlug: shows.slug,
      })
      .from(episodes)
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .where(eq(shows.userId, userId))
      .orderBy(desc(episodes.createdAt), episodes.title)
      .limit(5),
    // Plays and downloads from every country, for the map.
    db
      .select({
        country: sql<string>`${episodeActivity.country}`,
        plays: sql<number>`count(*) filter (where ${episodeActivity.type} = 'play')`.mapWith(Number),
        downloads: sql<number>`count(*) filter (where ${episodeActivity.type} = 'download')`.mapWith(Number),
      })
      .from(episodeActivity)
      .where(and(inPeriod, isNotNull(episodeActivity.country), sql`${episodeActivity.type} <> 'share'`))
      .groupBy(episodeActivity.country)
      .orderBy(desc(count()), episodeActivity.country),
  ])

  const previousTotals = { play: 0, download: 0, share: 0 }
  for (const row of previous) previousTotals[row.type] = row.count
  const byStatus = { pending: 0, processing: 0, ready: 0, failed: 0 }
  let totalSeconds = 0
  for (const row of episodeCounts) {
    byStatus[row.status] = row.count
    totalSeconds += row.seconds
  }

  return {
    days,
    shows: showCount,
    episodes: {
      total: byStatus.pending + byStatus.processing + byStatus.ready + byStatus.failed,
      inProgress: byStatus.pending + byStatus.processing,
      failed: byStatus.failed,
      totalSeconds,
    },
    activity,
    previousTotals,
    topEpisodes,
    recentEpisodes,
    countries,
  }
}
