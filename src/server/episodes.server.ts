import '@tanstack/react-start/server-only'
import { rm } from 'node:fs/promises'
import { and, count, desc, eq, isNotNull, isNull, max, or, sql } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { archiveDeletedShow, writeDeletedShowManifest } from '~/server/deleted-shows.server'
import { episodeLikes, episodes, playbackPositions, shows, users, type NewEpisode } from '~/server/db/schema'
import { publishEpisodeEvent } from '~/server/episode-events.server'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { saveLinkArtwork } from '~/server/link-details.server'
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
import { syncEpisodeTags } from '~/server/tags-store.server'
import { showAuthor } from '~/server/shows.server'
import { deleteWaveform, readWaveform } from '~/server/waveforms.server'
import { resample } from '~/lib/waveform'
import type { BulkUploadEpisodesInput, EditEpisodeInput, NewEpisodeInput, ReplaceAudioInput } from '~/lib/episode-schema'

// Whether the episode's audio is being replaced.
const replacing = sql<boolean>`${episodes.replacement} is not null`

// Episodes listeners can hear: ready, with audio. The feed and the public
// pages list these, newest first.
export const isPublished = and(eq(episodes.status, 'ready'), isNotNull(episodes.audioUrl))
// Published episodes that aren't private: what the feed and the public pages
// list. (A private show's are only seen by its owner and feed key holders.)
export const isListed = and(isPublished, eq(episodes.private, false))
export const newestPublishedFirst = desc(sql`coalesce(${episodes.publishedAt}, ${episodes.createdAt})`)

// What public pages may show of an episode: never its source, errors or
// replacement state.
export const publicEpisodeColumns = {
  id: episodes.id,
  title: episodes.title,
  slug: episodes.slug,
  shortSlug: episodes.shortSlug,
  description: episodes.description,
  imageUrl: episodes.imageUrl,
  audioUrl: episodes.audioUrl,
  durationSeconds: episodes.durationSeconds,
  explicit: episodes.explicit,
  createdAt: episodes.createdAt,
  publishedAt: episodes.publishedAt,
}

// How many people like the episode. In a query with a join, so drizzle
// qualifies the episode's id.
export const likeCount = sql<number>`(
  select count(*) from ${episodeLikes} where ${episodeLikes.episodeId} = ${episodes.id}
)`.mapWith(Number)

// Whether the listener (if signed in) likes the episode.
export function likedBy(listenerId: string | null) {
  return listenerId
    ? sql<boolean>`exists (
        select 1 from ${episodeLikes} where ${episodeLikes.episodeId} = ${episodes.id} and ${episodeLikes.userId} = ${listenerId}
      )`.mapWith(Boolean)
    : sql<boolean>`false`.mapWith(Boolean)
}

// An episode as listeners see it, with where they left off and its likes.
// Needs playbackPositions joined (see listenerPosition).
export function listenerEpisodeColumns(listenerId: string | null) {
  return {
    ...publicEpisodeColumns,
    positionSeconds: playbackPositions.positionSeconds,
    likeCount,
    liked: likedBy(listenerId),
  }
}

// Episodes the viewer may see on the public pages: anyone may see a public
// show's listed episodes, and owners may see all of theirs. Needs the
// show table joined.
export function visibleTo(viewerId: string | null) {
  const anyone = and(eq(shows.private, false), isListed)
  return viewerId ? or(anyone, and(isPublished, eq(shows.userId, viewerId))) : anyone
}

// Where the listener (if signed in) left off in an episode.
export function listenerPosition(listenerId: string | null) {
  return and(
    eq(playbackPositions.episodeId, episodes.id),
    listenerId ? eq(playbackPositions.userId, listenerId) : sql`false`,
  )
}

// A slice of a list, for pages that load episodes as they're scrolled to.
export type Page = { offset: number; limit: number }

// A show's published episodes, for its public page: all of them, or a page.
export function listPublishedEpisodes(showId: string, listenerId: string | null, page?: Page) {
  const query = db
    .select(listenerEpisodeColumns(listenerId))
    .from(episodes)
    .leftJoin(playbackPositions, listenerPosition(listenerId))
    .where(and(eq(episodes.showId, showId), isListed))
    // By id too, so pages split ties the same way each time.
    .orderBy(newestPublishedFirst, desc(episodes.id))
  return page ? query.offset(page.offset).limit(page.limit) : query
}

// How many episodes the public page has, their total length and when the
// latest came out, as it only loads some of them.
export async function summarisePublishedEpisodes(showId: string) {
  const [summary] = await db
    .select({
      count: count(),
      totalSeconds: sql`coalesce(sum(${episodes.durationSeconds}), 0)`.mapWith(Number),
      latestAt: sql`max(coalesce(${episodes.publishedAt}, ${episodes.createdAt}))`.mapWith(episodes.createdAt),
    })
    .from(episodes)
    .where(and(eq(episodes.showId, showId), isListed))
  return { count: summary!.count, totalSeconds: summary!.totalSeconds, latestAt: summary!.latestAt as Date | null }
}

// The listed episodes either side of one in its show, up to `each` newer and
// `each` older, newest first: the episode page links to them, so every
// episode can be reached from the next.
export async function listNeighbouringEpisodes(
  episode: { id: string; showId: string; publishedAt: Date | null; createdAt: Date },
  each = 3,
) {
  const at = sql`coalesce(${episodes.publishedAt}, ${episodes.createdAt})`
  const position = sql`(${(episode.publishedAt ?? episode.createdAt).toISOString()}::timestamptz, ${episode.id})`
  const columns = {
    id: episodes.id,
    slug: episodes.slug,
    title: episodes.title,
    publishedAt: episodes.publishedAt,
    createdAt: episodes.createdAt,
    durationSeconds: episodes.durationSeconds,
  }
  const ofShow = and(eq(episodes.showId, episode.showId), isListed)
  const [newer, older] = await Promise.all([
    db
      .select(columns)
      .from(episodes)
      .where(and(ofShow, sql`(${at}, ${episodes.id}) > ${position}`))
      .orderBy(at, episodes.id)
      .limit(each),
    db
      .select(columns)
      .from(episodes)
      .where(and(ofShow, sql`(${at}, ${episodes.id}) < ${position}`))
      .orderBy(newestPublishedFirst, desc(episodes.id))
      .limit(each),
  ])
  return [...newer.reverse(), ...older]
}

// A published episode, by show and episode slug, with its show; null if
// there's no such episode, it isn't ready, or it (or its show) is private
// and the listener isn't its owner.
export async function getPublicEpisode(showSlug: string, episodeSlug: string, listenerId: string | null) {
  const [row] = await db
    .select({
      episode: listenerEpisodeColumns(listenerId),
      show: {
        id: shows.id,
        title: shows.title,
        slug: shows.slug,
        imageUrl: shows.imageUrl,
        private: shows.private,
        feedKey: shows.feedKey,
        userId: shows.userId,
        author: showAuthor,
        // The owner's profile, which the author's name links to.
        ownerSlug: users.slug,
      },
    })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .innerJoin(users, eq(users.id, shows.userId))
    .leftJoin(playbackPositions, listenerPosition(listenerId))
    .where(and(eq(shows.slug, showSlug), eq(episodes.slug, episodeSlug), visibleTo(listenerId)))
    .limit(1)
  return row ?? null
}

// The episode a share page (/s/<shortSlug>) shows: the slugs of a published episode
// and its show, or null.
export async function findShortLink(shortSlug: string) {
  const [row] = await db
    .select({ slug: shows.slug, episodeSlug: episodes.slug })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(and(eq(episodes.shortSlug, shortSlug), isPublished))
    .limit(1)
  return row ?? null
}

// Includes where the user left off in each episode. All of them, or a page.
export function listEpisodes(userId: string, showId: string, page?: Page) {
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
      private: episodes.private,
      likeCount,
      createdAt: episodes.createdAt,
      publishedAt: episodes.publishedAt,
      positionSeconds: playbackPositions.positionSeconds,
    })
    .from(episodes)
    .leftJoin(
      playbackPositions,
      and(eq(playbackPositions.episodeId, episodes.id), eq(playbackPositions.userId, userId)),
    )
    .where(eq(episodes.showId, showId))
    // As the feed has them, so a channel's back catalogue is in upload order.
    .orderBy(newestPublishedFirst, desc(episodes.id))
  return page ? query.offset(page.offset).limit(page.limit) : query
}

// How many episodes a show has (in any state), the total length of the
// ready ones and when the latest was added, for its management page.
export async function summariseEpisodes(showId: string) {
  const [summary] = await db
    .select({
      count: count(),
      totalSeconds: sql`coalesce(sum(${episodes.durationSeconds}) filter (where ${episodes.status} = 'ready'), 0)`.mapWith(
        Number,
      ),
      latestAt: max(episodes.createdAt),
    })
    .from(episodes)
    .where(eq(episodes.showId, showId))
  return summary!
}

// One of the user's episodes, by show and episode slug, with its show
// and where the user left off.
export async function getEpisode(userId: string, showSlug: string, episodeSlug: string) {
  const [row] = await db
    .select({
      episode: {
        id: episodes.id,
        title: episodes.title,
        slug: episodes.slug,
        shortSlug: episodes.shortSlug,
        description: episodes.description,
        sourceUrl: episodes.sourceUrl,
        imageUrl: episodes.imageUrl,
        audioUrl: episodes.audioUrl,
        durationSeconds: episodes.durationSeconds,
        status: episodes.status,
        error: episodes.error,
        replacing,
        private: episodes.private,
        likeCount,
        createdAt: episodes.createdAt,
        publishedAt: episodes.publishedAt,
        positionSeconds: playbackPositions.positionSeconds,
      },
      show: {
        id: shows.id,
        title: shows.title,
        slug: shows.slug,
        imageUrl: shows.imageUrl,
        private: shows.private,
      },
    })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .leftJoin(
      playbackPositions,
      and(eq(playbackPositions.episodeId, episodes.id), eq(playbackPositions.userId, userId)),
    )
    .where(and(eq(episodes.slug, episodeSlug), eq(shows.userId, userId), eq(shows.slug, showSlug)))
    .limit(1)
  return row ?? null
}

// Saves a new episode, choosing another slug if its was taken meanwhile.
export async function insertEpisode(values: NewEpisode & { slug: string }, tags?: string[]) {
  const insert = (slug: string) =>
    db.transaction(async (tx) => {
      const [episode] = await tx
        .insert(episodes)
        .values({ ...values, slug })
        .returning({ id: episodes.id, slug: episodes.slug })
      if (tags !== undefined) await syncEpisodeTags(tx, episode!.id, tags)
      return episode!
    })
  try {
    return await insert(values.slug)
  } catch (error) {
    if (!isSlugConflict(error)) throw error
    return insert(withRandomSuffix(values.slug))
  }
}

// Returns null unless the show belongs to the user. The episode starts as
// "pending" and is downloaded or converted in the background.
// `pageImages`: artwork to fall back on for a link, if the platform has none.
export async function createEpisode(userId: string, input: NewEpisodeInput, { pageImages = [] }: { pageImages?: string[] } = {}) {
  const [show] = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)))
    .limit(1)
  if (!show) return null
  const description = input.description && plainTextToHtml(input.description)
  const upload = 'uploadId' in input ? await findUpload(userId, input.uploadId) : null
  if ('uploadId' in input && !upload) throw new Error('That upload has expired. Please choose the file again.')
  // The image is kept only once nothing else can go wrong with the form.
  const imageUrl = input.imageId ? await commitImage(userId, input.imageId) : null

  if ('uploadId' in input) {
    return insertUploadedEpisode(userId, show.id, upload!, { title: input.title, description, imageUrl }, input.tags)
  }

  const episode = await insertEpisode({
    showId: show.id,
    // Without a title, the link stands in until the source's own title is
    // fetched, and the slug is temporary until then.
    title: input.title ?? input.sourceUrl,
    slug: input.title ? await availableEpisodeSlug(show.id, input.title) : temporaryEpisodeSlug(),
    sourceUrl: input.sourceUrl,
    description,
    imageUrl,
    // Someone's waiting for it, so it goes ahead of channels' uploads.
    priority: 1,
  }, input.tags)
  // Open pages show it straight away, wherever it was added from (e.g. the
  // browser extension).
  publishEpisodeEvent({ type: 'changed', episodeId: episode.id })
  enqueueEpisode(episode.id)
  // Shown while it waits its turn to download.
  if (!imageUrl) void saveLinkArtwork(episode.id, input.sourceUrl, pageImages)
  return episode
}

// Makes an episode of a file the user has uploaded, handing the file over for
// the processor to convert.
async function insertUploadedEpisode(
  userId: string,
  showId: string,
  upload: UploadedAudio,
  details: Pick<NewEpisode, 'description' | 'imageUrl' | 'publishedAt'> & { title?: string },
  tags?: string[],
) {
  const title = details.title ?? upload.title
  const episode = await insertEpisode({
    ...details,
    showId,
    title,
    slug: await availableEpisodeSlug(showId, title),
    durationSeconds: upload.durationSeconds,
  }, tags)
  await moveUploadToEpisode(userId, upload.uploadId, episode.id)
  publishEpisodeEvent({ type: 'changed', episodeId: episode.id })
  enqueueEpisode(episode.id)
  return episode
}

// Makes an episode of each uploaded file (e.g. a folder of them), or returns
// null unless the show belongs to the user. Nothing is added if any upload
// has expired. Each is published a second after the one before, so the feed
// keeps the files' order however long each takes to convert.
export async function createUploadedEpisodes(userId: string, input: BulkUploadEpisodesInput) {
  const [show] = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)))
    .limit(1)
  if (!show) return null
  const uploads = await Promise.all(input.episodes.map((item) => findUpload(userId, item.uploadId)))
  if (uploads.some((upload) => !upload)) throw new Error('Some of the uploads have expired. Please choose the files again.')

  const start = Date.now()
  const created = []
  for (const [i, item] of input.episodes.entries()) {
    created.push(
      await insertUploadedEpisode(userId, show.id, uploads[i]!, { title: item.title, publishedAt: new Date(start + i * 1000) }),
    )
  }
  return created
}

// Who's asking for an episode's audio: the feed key from its URL, if any, and
// the signed-in user, looked up only if it's needed.
export type AudioAccess = { key: string | null; viewerId: () => Promise<string | null> }

// Only ready episodes have audio to serve, and only to those who may hear it:
// anyone, for a public show's listed episodes; those with the feed key, for
// a private show's; and the owner, for any of theirs.
export async function getEpisodeAudio(episodeId: string, access: AudioAccess) {
  const [episode] = await db
    .select({
      status: episodes.status,
      audioMimeType: episodes.audioMimeType,
      private: episodes.private,
      showPrivate: shows.private,
      feedKey: shows.feedKey,
      ownerId: shows.userId,
    })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(eq(episodes.id, episodeId))
    .limit(1)
  if (episode?.status !== 'ready') return null
  const listed = !episode.private && (!episode.showPrivate || (!!access.key && access.key === episode.feedKey))
  if (!listed && (await access.viewerId()) !== episode.ownerId) return null
  return { audioMimeType: episode.audioMimeType }
}

// The episode, if it belongs to one of the user's shows.
async function findOwnedEpisode(userId: string, episodeId: string) {
  const [episode] = await db
    .select({
      id: episodes.id,
      showId: episodes.showId,
      title: episodes.title,
      sourceUrl: episodes.sourceUrl,
      status: episodes.status,
      imageUrl: episodes.imageUrl,
      replacement: episodes.replacement,
    })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(and(eq(episodes.id, episodeId), eq(shows.userId, userId)))
    .limit(1)
  return episode ?? null
}

// Episodes that are mid-download, or having their audio replaced, can't be
// deleted until that finishes or fails.
export async function deleteEpisode(userId: string, episodeId: string) {
  const episode = await findOwnedEpisode(userId, episodeId)
  if (!episode || episode.status === 'processing' || episode.replacement) return false
  await db.delete(episodes).where(eq(episodes.id, episode.id))
  await deleteEpisodeFiles(episode)
  return true
}

// An episode's audio, kept source, artwork and waveform, once its row is gone.
async function deleteEpisodeFiles(episode: { id: string; imageUrl: string | null }) {
  await rm(episodeAudioPath(episode.id), { force: true })
  await rm(episodeSourcePath(episode.id), { force: true })
  await deleteImage(episode.imageUrl)
  await deleteWaveform(episode.id)
}

// Deletes one of the user's shows, with its episodes. Everything else that
// hangs off it (its channel, likes, follows, stats, playback positions) goes
// with its row; its files are moved to MEDIA_DIR/deleted by the show-archive
// job and kept there for 30 days (see deleted-shows.server.ts). Like deleting
// an episode, it waits until nothing's mid-download or having its audio
// replaced: 'busy' then, null if it isn't the user's show.
export async function deleteShow(userId: string, showId: string): Promise<'deleted' | 'busy' | null> {
  const owned = and(eq(shows.id, showId), eq(shows.userId, userId))
  const [show] = await db
    .select({ id: shows.id, title: shows.title, slug: shows.slug, userId: shows.userId })
    .from(shows)
    .where(owned)
    .limit(1)
  if (!show) return null
  const showEpisodes = await db
    .select({ id: episodes.id, title: episodes.title, slug: episodes.slug, imageUrl: episodes.imageUrl })
    .from(episodes)
    .where(eq(episodes.showId, showId))
  // In one statement, so an episode that starts processing meanwhile stops it.
  const [deleted] = await db
    .delete(shows)
    .where(
      and(
        owned,
        sql`not exists (
          select 1 from ${episodes}
          where ${episodes.showId} = ${showId} and (${episodes.status} = 'processing' or ${episodes.replacement} is not null)
        )`,
      ),
    )
    .returning({ imageUrl: shows.imageUrl })
  if (!deleted) return 'busy'
  await writeDeletedShowManifest({
    ...show,
    imageUrl: deleted.imageUrl,
    deletedAt: new Date().toISOString(),
    episodes: showEpisodes,
  })
  // Imported here, as the job queue needs this module.
  const { queueJob } = await import('~/server/jobs.server')
  if (!(await queueJob('show-archive', { showId }))) await archiveDeletedShow(showId)
  return 'deleted'
}

// The episode's current slug, for a page that's following an episode whose
// temporary slug is replaced once it's processed.
export async function getEpisodeSlug(userId: string, episodeId: string) {
  const [row] = await db
    .select({ slug: episodes.slug })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(and(eq(episodes.id, episodeId), eq(shows.userId, userId)))
    .limit(1)
  return row?.slug ?? null
}

// Hides an episode from everyone but the show's owner, or shows it again.
export async function setEpisodePrivacy(userId: string, episodeId: string, isPrivate: boolean) {
  const episode = await findOwnedEpisode(userId, episodeId)
  if (!episode) return false
  await db.update(episodes).set({ private: isPrivate }).where(eq(episodes.id, episode.id))
  return true
}

// Episodes can't be edited while they're being processed, which fills in their
// details when it finishes.
export async function updateEpisode(userId: string, input: EditEpisodeInput) {
  const episode = await findOwnedEpisode(userId, input.id)
  if (!episode || episode.status === 'pending' || episode.status === 'processing') return false
  const imageUrl =
    input.imageId === undefined ? episode.imageUrl : input.imageId ? await commitImage(userId, input.imageId) : null
  await db.transaction(async (tx) => {
    await tx
      .update(episodes)
      .set({ title: input.title, description: sanitizeDescription(input.description), imageUrl })
      .where(eq(episodes.id, episode.id))
    if (input.tags !== undefined) await syncEpisodeTags(tx, episode.id, input.tags)
  })
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
  episode: { id: string; showId: string; title: string; sourceUrl: string | null },
  sourceUrl: string | null,
  upload: UploadedAudio | null,
) {
  const untitled = episode.title === episode.sourceUrl
  const title = untitled ? (upload?.title ?? sourceUrl!) : episode.title
  const slug = untitled && upload ? await availableEpisodeSlug(episode.showId, upload.title, episode.id) : undefined
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
// they can see.
export async function savePlaybackPosition(userId: string, episodeId: string, seconds: number) {
  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(and(eq(episodes.id, episodeId), or(eq(shows.userId, userId), visibleTo(null))))
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

// Bars in the player bar's waveform: enough for its width on a wide screen.
const playerBars = 400

// An episode's waveform for the player bar, if the viewer may see the episode
// and it has one: null otherwise.
export async function getEpisodeWaveform(viewerId: string | null, episodeId: string) {
  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(and(eq(episodes.id, episodeId), visibleTo(viewerId)))
    .limit(1)
  const waveform = episode && (await readWaveform(episode.id))
  // The smoother of the two shapes, as the pages draw them.
  return waveform ? resample(waveform.rms, playerBars).map(Math.round) : null
}
