// An admin's page about one user (/admin/users/<id>): their shows and
// episodes, and how much of MEDIA_DIR is theirs. Callers check isAdmin.
// Disk use is measured from the files themselves, not the database, so it's
// only worked out here, for one user at a time.
import '@tanstack/react-start/server-only'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { asc, count, eq, inArray, max, sql } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import { db } from '~/server/db/client.server'
import {
  commentLikes,
  episodeComments,
  episodeLikes,
  episodes,
  ignoredShows,
  liveChatMessages,
  mobileTokens,
  playbackPositions,
  playedEpisodes,
  playlists,
  showFollows,
  shows,
  users,
} from '~/server/db/schema'
import { localImageUrl } from '~/server/images.server'
import { listeningHistoryFor } from '~/server/listening-history.server'
import { showRefColumns } from '~/server/shows.server'
import {
  episodeHlsDir,
  episodeMasterPath,
  episodeSourcePath,
  episodeWaveformPath,
  audioPath,
  imagePath,
  mediaDirs,
  replacementAudioName,
  userUploadsDir,
} from '~/server/storage.server'

// What a user's files are, as the page breaks their disk use down.
export type DiskUseKind = 'audio' | 'masters' | 'hls' | 'waveforms' | 'sources' | 'uploads' | 'images'

export type DiskUse = Record<DiskUseKind, number> & { total: number }

const emptyDiskUse = (): DiskUse => ({
  audio: 0,
  masters: 0,
  hls: 0,
  waveforms: 0,
  sources: 0,
  uploads: 0,
  images: 0,
  total: 0,
})

function add(into: DiskUse, kind: DiskUseKind, bytes: number) {
  into[kind] += bytes
  into.total += bytes
}

// The size of a file, or of everything in a folder; 0 when it isn't there.
async function sizeOf(path: string): Promise<number> {
  const stats = await stat(path).catch(() => null)
  if (!stats) return 0
  if (!stats.isDirectory()) return stats.size
  const names = await readdir(path).catch(() => [])
  let total = 0
  for (const name of names) total += await sizeOf(join(path, name))
  return total
}

// The ID of an image stored here, from the URL a show or episode has.
function storedImageId(url: string | null) {
  return url?.match(localImageUrl)?.[1] ?? null
}

// The sizes of each image's resized copies, which are made on request and
// named after it (see imageVariantPath).
async function variantSizes(imageIds: Set<string>) {
  const sizes = new Map<string, number>()
  if (imageIds.size === 0) return sizes
  const names = await readdir(mediaDirs.imageVariants).catch(() => [])
  for (const name of names) {
    // `<id>-<width>.<ext>` or `<id>-og.jpg`; IDs are UUIDs, 36 characters.
    const id = name.slice(0, 36)
    if (!imageIds.has(id)) continue
    sizes.set(id, (sizes.get(id) ?? 0) + (await sizeOf(join(mediaDirs.imageVariants, name))))
  }
  return sizes
}

async function imagesSize(imageIds: Iterable<string | null>, variants: Map<string, number>) {
  let total = 0
  for (const id of new Set(imageIds)) {
    if (id) total += (await sizeOf(imagePath(id))) + (variants.get(id) ?? 0)
  }
  return total
}

// The sizes of an episode's files, by kind: its MP3 and master (and any
// replacing them), HLS stream, waveform and, until it's processed, upload.
async function episodeFileSizes(episode: { id: string; hasReplacement: boolean }) {
  const files: [DiskUseKind, string][] = [
    ['audio', audioPath(episode.id)],
    ['masters', episodeMasterPath(episode.id)],
    ['hls', episodeHlsDir(episode.id)],
    ['waveforms', episodeWaveformPath(episode.id)],
    ['sources', episodeSourcePath(episode.id)],
  ]
  if (episode.hasReplacement) {
    const replacement = replacementAudioName(episode.id)
    files.push(['audio', audioPath(replacement)], ['masters', episodeMasterPath(replacement)])
  }
  return Promise.all(files.map(async ([kind, path]) => [kind, await sizeOf(path)] as const))
}

// Runs `fn` over the items a batch at a time, so a user with thousands of
// episodes doesn't open thousands of files at once.
async function mapInBatches<T, R>(items: T[], fn: (item: T) => Promise<R>, size = 16) {
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) results.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  return results
}

// How many rows of the user's a table has, and when the latest was made.
async function tally(table: PgTable & { userId: AnyPgColumn }, time: AnyPgColumn, userId: string) {
  const [row] = await db
    .select({ count: count(), lastAt: max(time) })
    .from(table)
    .where(eq(table.userId, userId))
  return { count: row?.count ?? 0, lastAt: (row?.lastAt as Date | null | undefined) ?? null }
}

export type ListenerActivity = Awaited<ReturnType<typeof listenerActivity>>

// What the user does as a listener, from what's already kept about them for
// the site's own features. Plays, downloads and shares aren't here: those
// (episode_activity) are never tied to an account (see activity.server.ts).
async function listenerActivity(userId: string) {
  const [started, played, likes, follows, ignored, comments, likedComments, chat, devices] = await Promise.all([
    tally(playbackPositions, playbackPositions.updatedAt, userId),
    tally(playedEpisodes, playedEpisodes.createdAt, userId),
    tally(episodeLikes, episodeLikes.createdAt, userId),
    tally(showFollows, showFollows.createdAt, userId),
    tally(ignoredShows, ignoredShows.createdAt, userId),
    tally(episodeComments, episodeComments.createdAt, userId),
    tally(commentLikes, commentLikes.createdAt, userId),
    tally(liveChatMessages, liveChatMessages.createdAt, userId),
    tally(mobileTokens, mobileTokens.lastUsedAt, userId),
  ])
  return { started, played, likes, follows, ignored, comments, likedComments, chat, devices }
}

export type AdminUserDetail = NonNullable<Awaited<ReturnType<typeof getAdminUserDetail>>>

// The user with their shows, each with its episodes counted and its files
// measured, and the totals across them; null when there's no such user.
export async function getAdminUserDetail(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      slug: users.slug,
      isAdmin: users.isAdmin,
      disabledAt: users.disabledAt,
      onHoldAt: users.onHoldAt,
      excludedAt: users.excludedAt,
      complimentaryAccess: users.complimentaryAccess,
    })
    .from(users)
    .where(eq(users.id, userId))
  if (!user) return null

  const [showRows, [playlistCount], listening, history] = await Promise.all([
    db
      .select({
        id: shows.id,
        title: shows.title,
        ...showRefColumns,
        private: shows.private,
        imageUrl: shows.imageUrl,
        createdAt: shows.createdAt,
      })
      .from(shows)
      .innerJoin(users, eq(users.id, shows.userId))
      .where(eq(shows.userId, userId))
      .orderBy(asc(shows.title)),
    db.select({ count: count() }).from(playlists).where(eq(playlists.userId, userId)),
    listenerActivity(userId),
    listeningHistoryFor(userId),
  ])
  const episodeRows = showRows.length
    ? await db
        .select({
          id: episodes.id,
          showId: episodes.showId,
          status: episodes.status,
          durationSeconds: episodes.durationSeconds,
          imageUrl: episodes.imageUrl,
          hasReplacement: sql<boolean>`${episodes.replacement} is not null`,
        })
        .from(episodes)
        .where(
          inArray(
            episodes.showId,
            showRows.map((show) => show.id),
          ),
        )
    : []

  const imageIds = new Set(
    [...showRows, ...episodeRows].map((row) => storedImageId(row.imageUrl)).filter((id): id is string => id !== null),
  )
  const variants = await variantSizes(imageIds)

  const totals = emptyDiskUse()
  const showDetails = []
  for (const show of showRows) {
    const own = episodeRows.filter((episode) => episode.showId === show.id)
    const statuses = { pending: 0, processing: 0, ready: 0, failed: 0 }
    let seconds = 0
    for (const episode of own) {
      statuses[episode.status]++
      seconds += episode.durationSeconds ?? 0
    }
    const disk = emptyDiskUse()
    for (const sizes of await mapInBatches(own, episodeFileSizes)) {
      for (const [kind, bytes] of sizes) add(disk, kind, bytes)
    }
    add(disk, 'images', await imagesSize([storedImageId(show.imageUrl), ...own.map((e) => storedImageId(e.imageUrl))], variants))
    for (const kind of Object.keys(disk) as (keyof DiskUse)[]) if (kind !== 'total') add(totals, kind, disk[kind])
    const { imageUrl: _, ...rest } = show
    showDetails.push({ ...rest, episodes: own.length, statuses, seconds, disk })
  }
  // Files uploaded but not yet made into episodes, and images not yet saved.
  add(totals, 'uploads', await sizeOf(userUploadsDir(userId)))
  add(totals, 'uploads', await sizeOf(join(mediaDirs.stagedImages, userId)))

  return {
    user,
    shows: showDetails.sort((a, b) => b.disk.total - a.disk.total),
    playlists: playlistCount?.count ?? 0,
    listening,
    history,
    episodes: episodeRows.length,
    seconds: showDetails.reduce((total, show) => total + show.seconds, 0),
    disk: totals,
  }
}
