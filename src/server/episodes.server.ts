import '@tanstack/react-start/server-only'
import { rm } from 'node:fs/promises'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, playbackPositions, podcasts } from '~/server/db/schema'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { episodeAudioPath, episodeSourcePath } from '~/server/storage.server'
import { findUpload, moveUploadToEpisode } from '~/server/uploads.server'
import { plainTextToHtml } from '~/lib/rich-text'
import { commitImage, deleteImage } from '~/server/images.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import type { EditEpisodeInput, NewEpisodeInput } from '~/lib/episode-schema'

// Includes where the user left off in each episode.
export function listEpisodes(userId: string, podcastId: string) {
  return db
    .select({
      id: episodes.id,
      title: episodes.title,
      description: episodes.description,
      sourceUrl: episodes.sourceUrl,
      imageUrl: episodes.imageUrl,
      audioUrl: episodes.audioUrl,
      durationSeconds: episodes.durationSeconds,
      status: episodes.status,
      error: episodes.error,
      createdAt: episodes.createdAt,
      positionSeconds: playbackPositions.positionSeconds,
    })
    .from(episodes)
    .leftJoin(
      playbackPositions,
      and(eq(playbackPositions.episodeId, episodes.id), eq(playbackPositions.userId, userId)),
    )
    .where(eq(episodes.podcastId, podcastId))
    .orderBy(desc(episodes.createdAt))
}

// Returns null unless the podcast belongs to the user. The episode starts as
// "pending" and is downloaded or converted in the background.
export async function createEpisode(userId: string, input: NewEpisodeInput) {
  const [podcast] = await db
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(and(eq(podcasts.id, input.podcastId), eq(podcasts.userId, userId)))
    .limit(1)
  if (!podcast) return null

  if ('uploadId' in input) {
    const upload = await findUpload(userId, input.uploadId)
    if (!upload) throw new Error('That upload has expired. Please choose the file again.')
    const [episode] = await db
      .insert(episodes)
      .values({
        podcastId: podcast.id,
        title: input.title ?? upload.title,
        description: input.description && plainTextToHtml(input.description),
        durationSeconds: upload.durationSeconds,
      })
      .returning({ id: episodes.id })
    await moveUploadToEpisode(userId, input.uploadId, episode!.id)
    enqueueEpisode(episode!.id)
    return episode!
  }

  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId: podcast.id,
      // Replaced by the source's own title once it's downloaded.
      title: input.title ?? input.sourceUrl,
      sourceUrl: input.sourceUrl,
      description: input.description && plainTextToHtml(input.description),
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

// The episode, if it belongs to one of the user's podcasts.
async function findOwnedEpisode(userId: string, episodeId: string) {
  const [episode] = await db
    .select({ id: episodes.id, status: episodes.status, imageUrl: episodes.imageUrl })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(episodes.id, episodeId), eq(podcasts.userId, userId)))
    .limit(1)
  return episode ?? null
}

// Episodes that are mid-download can't be deleted until they finish or fail.
export async function deleteEpisode(userId: string, episodeId: string) {
  const episode = await findOwnedEpisode(userId, episodeId)
  if (!episode || episode.status === 'processing') return false
  await db.delete(episodes).where(eq(episodes.id, episode.id))
  await rm(episodeAudioPath(episode.id), { force: true })
  await rm(episodeSourcePath(episode.id), { force: true })
  await deleteImage(episode.imageUrl)
  return true
}

// Episodes can't be edited while they're being processed, which fills in their
// details when it finishes.
export async function updateEpisode(userId: string, input: EditEpisodeInput) {
  const episode = await findOwnedEpisode(userId, input.id)
  if (!episode || episode.status === 'pending' || episode.status === 'processing') return false
  const imageUrl =
    input.imageId === undefined ? episode.imageUrl : input.imageId ? await commitImage(userId, input.imageId) : null
  await db
    .update(episodes)
    .set({ title: input.title, description: sanitizeDescription(input.description), imageUrl })
    .where(eq(episodes.id, episode.id))
  if (imageUrl !== episode.imageUrl) await deleteImage(episode.imageUrl)
  return true
}

// Queues a failed episode to be downloaded again.
export async function retryEpisode(userId: string, episodeId: string) {
  const episode = await findOwnedEpisode(userId, episodeId)
  if (!episode || episode.status !== 'failed') return false
  await db.update(episodes).set({ status: 'pending', error: null }).where(eq(episodes.id, episode.id))
  enqueueEpisode(episode.id)
  return true
}

// Records where the user left off; a position of 0 (e.g. they finished it) clears it.
export async function savePlaybackPosition(userId: string, episodeId: string, seconds: number) {
  const episode = await findOwnedEpisode(userId, episodeId)
  if (!episode) return false
  const positionSeconds = Math.floor(seconds)
  if (positionSeconds > 0) {
    await db
      .insert(playbackPositions)
      .values({ userId, episodeId, positionSeconds })
      .onConflictDoUpdate({
        target: [playbackPositions.userId, playbackPositions.episodeId],
        set: { positionSeconds, updatedAt: new Date() },
      })
  } else {
    await db
      .delete(playbackPositions)
      .where(and(eq(playbackPositions.userId, userId), eq(playbackPositions.episodeId, episodeId)))
  }
  return true
}
