import '@tanstack/react-start/server-only'
import { rm } from 'node:fs/promises'
import { and, count, desc, eq, isNotNull, isNull, max, or, sql } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, playbackPositions, podcasts, users, type NewEpisode } from '~/server/db/schema'
import { enqueueEpisode } from '~/server/episode-processor.server'
import {
  availableEpisodeSlug,
  isSlugConflict,
  temporaryEpisodeSlug,
  withRandomSuffix,
} from '~/server/episode-slugs.server'
import { episodeAudioPath, episodeSourcePath } from '~/server/storage.server'
import { findUpload, moveUploadToEpisode, type UploadedAudio } from '~/server/uploads.server'
import { plainTextToHtml } from '~/lib/rich-text'
import { commitImage, deleteImage } from '~/server/images.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { deleteWaveform } from '~/server/waveforms.server'
import type { EditEpisodeInput, NewEpisodeInput, ReplaceAudioInput } from '~/lib/episode-schema'

// Whether the episode's audio is being replaced.
const replacing = sql<boolean>`${episodes.replacement} is not null`

// Episodes listeners can hear: ready, with audio. The feed and the public
// pages list these, newest first.
export const isPublished = and(eq(episodes.status, 'ready'), isNotNull(episodes.audioUrl))
export const newestPublishedFirst = desc(sql`coalesce(${episodes.publishedAt}, ${episodes.createdAt})`)

// What public pages may show of an episode: never its source, errors or
// replacement state.
const publicEpisodeColumns = {
  id: episodes.id,
  title: episodes.title,
  slug: episodes.slug,
  description: episodes.description,
  imageUrl: episodes.imageUrl,
  audioUrl: episodes.audioUrl,
  durationSeconds: episodes.durationSeconds,
  explicit: episodes.explicit,
  createdAt: episodes.createdAt,
  publishedAt: episodes.publishedAt,
}

// Where the listener (if signed in) left off in an episode.
function listenerPosition(listenerId: string | null) {
  return and(
    eq(playbackPositions.episodeId, episodes.id),
    listenerId ? eq(playbackPositions.userId, listenerId) : sql`false`,
  )
}

// A slice of a list, for pages that load episodes as they're scrolled to.
export type Page = { offset: number; limit: number }

// A podcast's published episodes, for its public page: all of them, or a page.
export function listPublishedEpisodes(podcastId: string, listenerId: string | null, page?: Page) {
  const query = db
    .select({ ...publicEpisodeColumns, positionSeconds: playbackPositions.positionSeconds })
    .from(episodes)
    .leftJoin(playbackPositions, listenerPosition(listenerId))
    .where(and(eq(episodes.podcastId, podcastId), isPublished))
    // By id too, so pages split ties the same way each time.
    .orderBy(newestPublishedFirst, desc(episodes.id))
  return page ? query.offset(page.offset).limit(page.limit) : query
}

// How many episodes the public page has, their total length and when the
// latest came out, as it only loads some of them.
export async function summarisePublishedEpisodes(podcastId: string) {
  const [summary] = await db
    .select({
      count: count(),
      totalSeconds: sql`coalesce(sum(${episodes.durationSeconds}), 0)`.mapWith(Number),
      latestAt: sql`max(coalesce(${episodes.publishedAt}, ${episodes.createdAt}))`.mapWith(episodes.createdAt),
    })
    .from(episodes)
    .where(and(eq(episodes.podcastId, podcastId), isPublished))
  return { count: summary!.count, totalSeconds: summary!.totalSeconds, latestAt: summary!.latestAt as Date | null }
}

// A published episode, by podcast and episode slug, with its podcast; null if
// there's no such episode or it isn't ready. Private podcasts are included:
// they're unlisted, not secret.
export async function getPublicEpisode(podcastSlug: string, episodeSlug: string, listenerId: string | null) {
  const [row] = await db
    .select({
      episode: { ...publicEpisodeColumns, positionSeconds: playbackPositions.positionSeconds },
      podcast: {
        id: podcasts.id,
        title: podcasts.title,
        slug: podcasts.slug,
        imageUrl: podcasts.imageUrl,
        private: podcasts.private,
        userId: podcasts.userId,
        author: users.name,
      },
    })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .innerJoin(users, eq(users.id, podcasts.userId))
    .leftJoin(playbackPositions, listenerPosition(listenerId))
    .where(and(eq(podcasts.slug, podcastSlug), eq(episodes.slug, episodeSlug), isPublished))
    .limit(1)
  return row ?? null
}

// Includes where the user left off in each episode. All of them, or a page.
export function listEpisodes(userId: string, podcastId: string, page?: Page) {
  const query = db
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
      replacing,
      createdAt: episodes.createdAt,
      positionSeconds: playbackPositions.positionSeconds,
    })
    .from(episodes)
    .leftJoin(
      playbackPositions,
      and(eq(playbackPositions.episodeId, episodes.id), eq(playbackPositions.userId, userId)),
    )
    .where(eq(episodes.podcastId, podcastId))
    .orderBy(desc(episodes.createdAt), desc(episodes.id))
  return page ? query.offset(page.offset).limit(page.limit) : query
}

// How many episodes a podcast has (in any state), the total length of the
// ready ones and when the latest was added, for its management page.
export async function summariseEpisodes(podcastId: string) {
  const [summary] = await db
    .select({
      count: count(),
      totalSeconds: sql`coalesce(sum(${episodes.durationSeconds}) filter (where ${episodes.status} = 'ready'), 0)`.mapWith(
        Number,
      ),
      latestAt: max(episodes.createdAt),
    })
    .from(episodes)
    .where(eq(episodes.podcastId, podcastId))
  return summary!
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
        replacing,
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
export async function insertEpisode(values: NewEpisode & { slug: string }) {
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
  const upload = 'uploadId' in input ? await findUpload(userId, input.uploadId) : null
  if ('uploadId' in input && !upload) throw new Error('That upload has expired. Please choose the file again.')
  // The image is kept only once nothing else can go wrong with the form.
  const imageUrl = input.imageId ? await commitImage(userId, input.imageId) : null

  if ('uploadId' in input) {
    const title = input.title ?? upload!.title
    const episode = await insertEpisode({
      podcastId: podcast.id,
      title,
      slug: await availableEpisodeSlug(podcast.id, title),
      description,
      imageUrl,
      durationSeconds: upload!.durationSeconds,
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
    imageUrl,
    // Someone's waiting for it, so it goes ahead of channels' uploads.
    priority: 1,
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
    .select({
      id: episodes.id,
      podcastId: episodes.podcastId,
      title: episodes.title,
      sourceUrl: episodes.sourceUrl,
      status: episodes.status,
      imageUrl: episodes.imageUrl,
      replacement: episodes.replacement,
    })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(episodes.id, episodeId), eq(podcasts.userId, userId)))
    .limit(1)
  return episode ?? null
}

// Episodes that are mid-download, or having their audio replaced, can't be
// deleted until that finishes or fails.
export async function deleteEpisode(userId: string, episodeId: string) {
  const episode = await findOwnedEpisode(userId, episodeId)
  if (!episode || episode.status === 'processing' || episode.replacement) return false
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

// Gives an episode new audio from a link or upload, made in the background.
// A ready episode keeps its title, description and artwork, and its current
// audio stays in the feed until the new audio is ready. A failed episode has
// no audio to keep, so it's processed again from the new source.
export async function replaceEpisodeAudio(userId: string, input: ReplaceAudioInput) {
  const episode = await findOwnedEpisode(userId, input.id)
  if (!episode) return false
  const upload = 'uploadId' in input ? await findUpload(userId, input.uploadId) : null
  if ('uploadId' in input && !upload) throw new Error('That upload has expired. Please choose the file again.')
  const sourceUrl = 'sourceUrl' in input ? input.sourceUrl : null

  const claimed =
    episode.status === 'failed'
      ? await claimFailedEpisode(episode, sourceUrl, upload)
      : // Only one replacement at a time, even if two requests race.
        await db
          .update(episodes)
          .set({ replacement: { sourceUrl }, error: null })
          .where(and(eq(episodes.id, episode.id), eq(episodes.status, 'ready'), isNull(episodes.replacement)))
          .returning({ id: episodes.id })
          .then(([row]) => row)
  if (!claimed) return false

  if ('uploadId' in input) {
    try {
      await moveUploadToEpisode(userId, input.uploadId, episode.id)
    } catch (error) {
      await db
        .update(episodes)
        .set(episode.status === 'failed' ? { status: 'failed', error: 'The uploaded file went missing' } : { replacement: null })
        .where(eq(episodes.id, episode.id))
      throw error
    }
  } else if (episode.status === 'failed') {
    // A failed upload's file, kept for retrying, isn't needed any more.
    await rm(episodeSourcePath(episode.id), { force: true })
  }
  enqueueEpisode(episode.id)
  return true
}

// Points a failed episode at its new source and queues it again. One still
// titled by its old link (whose title was never fetched) is titled from the
// new source instead: from an upload now, from a link once it's fetched.
async function claimFailedEpisode(
  episode: { id: string; podcastId: string; title: string; sourceUrl: string | null },
  sourceUrl: string | null,
  upload: UploadedAudio | null,
) {
  const untitled = episode.title === episode.sourceUrl
  const title = untitled ? (upload?.title ?? sourceUrl!) : episode.title
  const slug = untitled && upload ? await availableEpisodeSlug(episode.podcastId, upload.title, episode.id) : undefined
  const update = (slug: string | undefined) =>
    db
      .update(episodes)
      .set({
        status: 'pending',
        error: null,
        sourceUrl,
        title,
        slug,
        ...(upload && { durationSeconds: upload.durationSeconds }),
      })
      .where(and(eq(episodes.id, episode.id), eq(episodes.status, 'failed')))
      .returning({ id: episodes.id })
      .then(([row]) => row)
  try {
    return await update(slug)
  } catch (error) {
    if (!slug || !isSlugConflict(error)) throw error
    return update(withRandomSuffix(slug))
  }
}

// Clears the note left on a ready episode when replacing its audio failed.
export async function dismissEpisodeError(userId: string, episodeId: string) {
  const episode = await findOwnedEpisode(userId, episodeId)
  if (!episode || episode.status !== 'ready') return false
  await db.update(episodes).set({ error: null }).where(eq(episodes.id, episode.id))
  return true
}

// Records where the user left off; a position of 0 (e.g. they finished it) clears it.
// Listeners can keep their place in their own episodes and in anyone's
// published ones.
export async function savePlaybackPosition(userId: string, episodeId: string, seconds: number) {
  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(episodes.id, episodeId), or(eq(podcasts.userId, userId), isPublished)))
    .limit(1)
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
