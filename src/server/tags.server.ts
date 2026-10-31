import '@tanstack/react-start/server-only'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import type { TagSort } from '~/lib/tag-schema'
import { db } from '~/server/db/client.server'
import { episodeLikes, episodes, episodeTags, playbackPositions, shows, showTags } from '~/server/db/schema'
import { isListed, likeCount, listenerEpisodeColumns, listenerPosition, newestPublishedFirst, type Page } from '~/server/episodes.server'
import { popularDays } from '~/server/library.server'
import { withEpisodeTags } from '~/server/tags-store.server'

// Storage helpers have no dependency on episodes/library, so those modules can
// attach or save tags without creating an initialization cycle.
export * from '~/server/tags-store.server'

function taggedPublicEpisode(tagId: string) {
  return and(
    eq(shows.private, false),
    isListed,
    // EXISTS keeps an episode occurring once when it and its show both match.
    sql`(exists (
      select 1 from ${episodeTags} where ${episodeTags.episodeId} = ${episodes.id} and ${episodeTags.tagId} = ${tagId}
    ) or exists (
      select 1 from ${showTags} where ${showTags.showId} = ${shows.id} and ${showTags.tagId} = ${tagId}
    ))`,
  )
}

export async function countTagEpisodes(tagId: string) {
  const [row] = await db.select({ count: count() }).from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId)).where(taggedPublicEpisode(tagId))
  return row!.count
}

// Public discovery always excludes private content, including the viewer's.
// Upload order follows the source upload date, falling back to its import date.
export async function listTagEpisodes(tagId: string, viewerId: string | null, sort: TagSort, page: Page) {
  const since = new Date(Date.now() - popularDays * 24 * 60 * 60 * 1000)
  const recentLikes = sql<number>`(
    select count(*) from ${episodeLikes}
    where ${episodeLikes.episodeId} = ${episodes.id} and ${episodeLikes.createdAt} > ${since.toISOString()}
  )`
  const rows = await db.select({
    ...listenerEpisodeColumns(viewerId),
    show: {
      slug: shows.slug,
      title: shows.title,
      imageUrl: shows.imageUrl,
      userId: shows.userId,
    },
  }).from(episodes).innerJoin(shows, eq(shows.id, episodes.showId))
    .leftJoin(playbackPositions, listenerPosition(viewerId))
    .where(taggedPublicEpisode(tagId))
    .orderBy(...(sort === 'popular' ? [desc(recentLikes), desc(likeCount)] : []), newestPublishedFirst, desc(episodes.id))
    .offset(page.offset).limit(page.limit)
  return withEpisodeTags(rows.map(({ show: { userId, ...show }, ...episode }) => ({
    ...episode,
    show: { ...show, isOwner: userId === viewerId },
  })))
}
