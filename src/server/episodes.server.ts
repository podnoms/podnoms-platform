import '@tanstack/react-start/server-only'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, podcasts } from '~/server/db/schema'
import { enqueueEpisode } from '~/server/episode-processor.server'
import type { NewEpisodeInput } from '~/lib/episode-schema'

export function listEpisodes(podcastId: string) {
  return db
    .select({
      id: episodes.id,
      title: episodes.title,
      sourceUrl: episodes.sourceUrl,
      imageUrl: episodes.imageUrl,
      audioUrl: episodes.audioUrl,
      durationSeconds: episodes.durationSeconds,
      status: episodes.status,
      error: episodes.error,
      createdAt: episodes.createdAt,
    })
    .from(episodes)
    .where(eq(episodes.podcastId, podcastId))
    .orderBy(desc(episodes.createdAt))
}

// Returns null unless the podcast belongs to the user. The episode starts as
// "pending" and is downloaded in the background.
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
      // Replaced by the source's own title once it's downloaded.
      title: input.title ?? input.sourceUrl,
      sourceUrl: input.sourceUrl,
      description: input.description,
    })
    .returning({ id: episodes.id })
  enqueueEpisode(episode!.id)
  return episode!
}

// Only ready episodes have audio to serve.
export async function getEpisodeAudio(episodeId: string) {
  const [episode] = await db
    .select({ status: episodes.status, audioMimeType: episodes.audioMimeType })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1)
  return episode?.status === 'ready' ? episode : null
}
