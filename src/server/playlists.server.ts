// Users' playlists: episodes from any shows, in an order they choose, to
// play through one after another. A playlist is private until its owner makes
// it public, which gives it a page at /u/<user slug>/playlists/<slug> and a
// place on their profile. Only episodes the user can see can go in, and a
// playlist only ever shows each viewer the episodes they may see (see
// visibleTo), so one made private later drops out for everyone else.
import '@tanstack/react-start/server-only'
import { and, asc, count, desc, eq, like, max, or, sql } from 'drizzle-orm'
import { firstFreeSlug, slugify } from '~/lib/slug'
import { db } from '~/server/db/client.server'
import { episodes, playlistItems, playlists, shows, users } from '~/server/db/schema'
import { visibleTo } from '~/server/episodes.server'
import { listenerEpisodes, withOwnership } from '~/server/library.server'

export type PlaylistInput = { title: string; description: string | null; private: boolean }

// A free slug among the user's playlists, from the title.
async function availableSlug(userId: string, title: string) {
  const base = slugify(title, 'playlist')
  const taken = await db
    .select({ slug: playlists.slug })
    .from(playlists)
    .where(and(eq(playlists.userId, userId), or(eq(playlists.slug, base), like(playlists.slug, `${base}-%`))))
  return firstFreeSlug(base, new Set(taken.map((row) => row.slug)))
}

export async function createPlaylist(userId: string, input: PlaylistInput) {
  const [playlist] = await db
    .insert(playlists)
    .values({ userId, ...input, slug: await availableSlug(userId, input.title) })
    .returning({ id: playlists.id, slug: playlists.slug })
  return playlist!
}

// Returns whether the user has such a playlist. The slug stays as it was.
export async function updatePlaylist(userId: string, playlistId: string, input: PlaylistInput) {
  const updated = await db
    .update(playlists)
    .set(input)
    .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
    .returning({ id: playlists.id })
  return updated.length > 0
}

export async function deletePlaylist(userId: string, playlistId: string) {
  const deleted = await db
    .delete(playlists)
    .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
    .returning({ id: playlists.id })
  return deleted.length > 0
}

async function ownPlaylist(userId: string, playlistId: string) {
  const [playlist] = await db
    .select({ id: playlists.id })
    .from(playlists)
    .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
    .limit(1)
  return playlist ?? null
}

// Puts an episode the user can see at the end of their playlist (if it isn't
// in it already). Returns false if there's no such playlist or episode.
export async function addToPlaylist(userId: string, playlistId: string, episodeId: string) {
  if (!(await ownPlaylist(userId, playlistId))) return false
  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(and(eq(episodes.id, episodeId), visibleTo(userId)))
    .limit(1)
  if (!episode) return false
  const [last] = await db
    .select({ position: max(playlistItems.position) })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlistId))
  await db
    .insert(playlistItems)
    .values({ playlistId, episodeId, position: (last?.position ?? -1) + 1 })
    .onConflictDoNothing()
  await touch(playlistId)
  return true
}

export async function removeFromPlaylist(userId: string, playlistId: string, episodeId: string) {
  if (!(await ownPlaylist(userId, playlistId))) return false
  await db
    .delete(playlistItems)
    .where(and(eq(playlistItems.playlistId, playlistId), eq(playlistItems.episodeId, episodeId)))
  await touch(playlistId)
  return true
}

// Puts the playlist's episodes in this order. Any it holds that aren't listed
// (such as ones the user can no longer see) keep their place after them.
export async function reorderPlaylist(userId: string, playlistId: string, episodeIds: string[]) {
  if (!(await ownPlaylist(userId, playlistId))) return false
  const current = await db
    .select({ episodeId: playlistItems.episodeId })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlistId))
    .orderBy(asc(playlistItems.position))
  const held = new Set(current.map((item) => item.episodeId))
  const listed = [...new Set(episodeIds)].filter((id) => held.has(id))
  const order = [...listed, ...current.map((item) => item.episodeId).filter((id) => !listed.includes(id))]
  await db.transaction(async (tx) => {
    for (const [position, episodeId] of order.entries())
      await tx
        .update(playlistItems)
        .set({ position })
        .where(and(eq(playlistItems.playlistId, playlistId), eq(playlistItems.episodeId, episodeId)))
  })
  await touch(playlistId)
  return true
}

const touch = (playlistId: string) => db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId))

// The user's playlists, most recently changed first, each with how many
// episodes it has and, given an episode, whether it's in it.
export async function listMyPlaylists(userId: string, episodeId?: string) {
  const rows = await db
    .select({
      id: playlists.id,
      title: playlists.title,
      slug: playlists.slug,
      private: playlists.private,
      episodeCount: count(playlistItems.episodeId),
      contains: episodeId
        ? sql<boolean>`bool_or(${playlistItems.episodeId} = ${episodeId})`
        : sql<boolean>`false`,
    })
    .from(playlists)
    .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.userId, userId))
    .groupBy(playlists.id)
    .orderBy(desc(playlists.updatedAt), asc(playlists.title))
  return rows.map((row) => ({ ...row, contains: Boolean(row.contains) }))
}

// A user's public playlists, for their profile, with how many episodes each
// has that anyone may see.
export async function listPublicPlaylists(ownerId: string) {
  return db
    .select({
      id: playlists.id,
      title: playlists.title,
      slug: playlists.slug,
      episodeCount: sql<number>`count(${episodes.id}) filter (where ${visibleTo(null)})`.mapWith(Number),
    })
    .from(playlists)
    .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
    .leftJoin(episodes, eq(episodes.id, playlistItems.episodeId))
    .leftJoin(shows, eq(shows.id, episodes.showId))
    .where(and(eq(playlists.userId, ownerId), eq(playlists.private, false)))
    .groupBy(playlists.id)
    .orderBy(desc(playlists.updatedAt))
}

// A playlist's page, if the viewer may see it (it's public, or theirs): its
// details, who made it, and the episodes the viewer may see, in order.
export async function getPlaylistPage(ownerSlug: string, playlistSlug: string, viewerId: string | null) {
  const [playlist] = await db
    .select({
      id: playlists.id,
      title: playlists.title,
      slug: playlists.slug,
      description: playlists.description,
      private: playlists.private,
      updatedAt: playlists.updatedAt,
      ownerId: playlists.userId,
      owner: { slug: users.slug, name: users.name, image: users.image },
    })
    .from(playlists)
    .innerJoin(users, eq(users.id, playlists.userId))
    .where(and(eq(users.slug, ownerSlug.toLowerCase()), eq(playlists.slug, playlistSlug)))
    .limit(1)
  if (!playlist || (playlist.private && playlist.ownerId !== viewerId)) return null
  const rows = await listenerEpisodes(viewerId)
    .innerJoin(playlistItems, eq(playlistItems.episodeId, episodes.id))
    .where(and(eq(playlistItems.playlistId, playlist.id), visibleTo(viewerId)))
    .orderBy(asc(playlistItems.position))
  const { ownerId, ...rest } = playlist
  return { ...rest, isOwner: ownerId === viewerId, episodes: withOwnership(rows, viewerId) }
}
