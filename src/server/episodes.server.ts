import '@tanstack/react-start/server-only'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, podcasts } from '~/server/db/schema'
import type { NewEpisodeInput } from '~/lib/episode-schema'

export function listEpisodes(podcastId: string) {
  return db
    .select({
      id: episodes.id,
      title: episodes.title,
      description: episodes.description,
      sourceUrl: episodes.sourceUrl,
      status: episodes.status,
      createdAt: episodes.createdAt,
    })
    .from(episodes)
    .where(eq(episodes.podcastId, podcastId))
    .orderBy(desc(episodes.createdAt))
}

// Returns null unless the podcast belongs to the user.
export async function createEpisode(userId: string, input: NewEpisodeInput) {
  const [podcast] = await db
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(and(eq(podcasts.id, input.podcastId), eq(podcasts.userId, userId)))
    .limit(1)
  if (!podcast) return null
  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId: podcast.id,
      title: input.title,
      sourceUrl: input.sourceUrl,
      description: input.description,
    })
    .returning({ id: episodes.id })
  return episode!
}
