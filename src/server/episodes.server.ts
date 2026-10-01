import '@tanstack/react-start/server-only'
import { rm } from 'node:fs/promises'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, playbackPositions, podcasts, type NewEpisode } from '~/server/db/schema'
import { enqueueEpisode } from '~/server/episode-processor.server'
import {
  availableEpisodeSlug,
  isSlugConflict,
  temporaryEpisodeSlug,
  withRandomSuffix,
} from '~/server/episode-slugs.server'
import { episodeAudioPath, episodeSourcePath } from '~/server/storage.server'
import { findUpload, moveUploadToEpisode } from '~/server/uploads.server'
import { plainTextToHtml } from '~/lib/rich-text'
import { commitImage, deleteImage } from '~/server/images.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { deleteWaveform } from '~/server/waveforms.server'
import type { EditEpisodeInput, NewEpisodeInput } from '~/lib/episode-schema'

// Includes where the user left off in each episode.
export function listEpisodes(userId: string, podcastId: string) {
  return db
    .select({
      id: episodes.id,
      title: episodes.title,
      slug: episodes.slug,
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

// One of the user's episodes, by podcast and episode slug, with its podcast
// and where the user left off.
export async function getEpisode(userId: string, podcastSlug: string, episodeSlug: string) {
  const [row] = await db
    .select({
      episode: {
        id: episodes.id,
        title: episodes.title,
        slug: episodes.slug,
        description: episodes.description,
        sourceUrl: episodes.sourceUrl,
        imageUrl: episodes.imageUrl,
        audioUrl: episodes.audioUrl,
        durationSeconds: episodes.durationSeconds,
        status: episodes.status,
        error: episodes.error,
        createdAt: episodes.createdAt,
        publishedAt: episodes.publishedAt,
        positionSeconds: playbackPositions.positionSeconds,
      },
      podcast: { id: podcasts.id, title: podcasts.title, slug: podcasts.slug, imageUrl: podcasts.imageUrl },
    })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .leftJoin(
      playbackPositions,
      and(eq(playbackPositions.episodeId, episodes.id), eq(playbackPositions.userId, userId)),
    )
    .where(and(eq(episodes.slug, episodeSlug), eq(podcasts.userId, userId), eq(podcasts.slug, podcastSlug)))
    .limit(1)
  return row ?? null
}

// Saves a new episode, choosing another slug if its was taken meanwhile.
async function insertEpisode(values: NewEpisode & { slug: string }) {
  const insert = (slug: string) =>
    db
      .insert(episodes)
      .values({ ...values, slug })
      .returning({ id: episodes.id, slug: episodes.slug })
      .then(([episode]) => episode!)
  try {
    return await insert(values.slug)
  } catch (error) {
    if (!isSlugConflict(error)) throw error
    return insert(withRandomSuffix(values.slug))
  }
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
  const description = input.description && plainTextToHtml(input.description)

  if ('uploadId' in input) {
    const upload = await findUpload(userId, input.uploadId)
    if (!upload) throw new Error('That upload has expired. Please choose the file again.')
    const title = input.title ?? upload.title
    const episode = await insertEpisode({
      podcastId: podcast.id,
      title,
      slug: await availableEpisodeSlug(podcast.id, title),
      description,
      durationSeconds: upload.durationSeconds,
    })
    await moveUploadToEpisode(userId, input.uploadId, episode.id)
    enqueueEpisode(episode.id)
    return episode
  }

  const episode = await insertEpisode({
    podcastId: podcast.id,
    // Without a title, the link stands in until the source's own title is
    // fetched, and the slug is temporary until then.
    title: input.title ?? input.sourceUrl,
    slug: input.title ? await availableEpisodeSlug(podcast.id, input.title) : temporaryEpisodeSlug(),
    sourceUrl: input.sourceUrl,
    description,
  })
  enqueueEpisode(episode.id)
  return episode
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
  await deleteWaveform(episode.id)
  return true
}

// The episode's current slug, for a page that's following an episode whose
// temporary slug is replaced once it's processed.
export async function getEpisodeSlug(userId: string, episodeId: string) {
  const [row] = await db
    .select({ slug: episodes.slug })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(episodes.id, episodeId), eq(podcasts.userId, userId)))
    .limit(1)
  return row?.slug ?? null
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
