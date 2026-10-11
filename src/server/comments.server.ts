// Comments on episodes. Each is made at a point in the episode (where the
// listener was when they wrote it), and they're listed in that order. Only
// signed-in users can comment, on episodes they can see; a comment can be
// deleted by whoever wrote it or by the podcast's owner.
import '@tanstack/react-start/server-only'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodeComments, episodes, podcasts, users } from '~/server/db/schema'
import { visibleTo } from '~/server/episodes.server'

// The episode, if the viewer can see it, with who owns its podcast.
async function visibleEpisode(episodeId: string, viewerId: string | null) {
  const [episode] = await db
    .select({ id: episodes.id, durationSeconds: episodes.durationSeconds, ownerId: podcasts.userId })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(episodes.id, episodeId), visibleTo(viewerId)))
    .limit(1)
  return episode ?? null
}

// An episode's comments in the order they come in it (then oldest first),
// with who wrote them and whether the viewer may delete each. Empty if the
// viewer can't see the episode.
export async function listComments(episodeId: string, viewerId: string | null) {
  const episode = await visibleEpisode(episodeId, viewerId)
  if (!episode) return []
  const rows = await db
    .select({
      id: episodeComments.id,
      body: episodeComments.body,
      atSeconds: episodeComments.atSeconds,
      createdAt: episodeComments.createdAt,
      userId: episodeComments.userId,
      author: { name: users.name, image: users.image },
    })
    .from(episodeComments)
    .innerJoin(users, eq(users.id, episodeComments.userId))
    .where(eq(episodeComments.episodeId, episodeId))
    .orderBy(asc(episodeComments.atSeconds), asc(episodeComments.createdAt), asc(episodeComments.id))
  // Who wrote them is shown by name; their ids stay on the server.
  return rows.map(({ userId, ...comment }) => ({
    ...comment,
    canDelete: viewerId !== null && (userId === viewerId || episode.ownerId === viewerId),
  }))
}

export type EpisodeComment = Awaited<ReturnType<typeof listComments>>[number]

// Adds a comment at `atSeconds` (kept within the episode). Returns the
// episode's comments, or null if there's no such episode for the user.
export async function addComment(userId: string, episodeId: string, body: string, atSeconds: number) {
  const episode = await visibleEpisode(episodeId, userId)
  if (!episode) return null
  const end = episode.durationSeconds ?? Number.POSITIVE_INFINITY
  await db.insert(episodeComments).values({
    episodeId,
    userId,
    body: body.trim(),
    atSeconds: Math.max(0, Math.min(Math.floor(atSeconds), Math.floor(end))),
  })
  return listComments(episodeId, userId)
}

// Deletes a comment the user wrote, or one on their own podcast. Returns
// whether one was deleted.
export async function deleteComment(userId: string, commentId: string) {
  const [comment] = await db
    .select({ writerId: episodeComments.userId, ownerId: podcasts.userId })
    .from(episodeComments)
    .innerJoin(episodes, eq(episodes.id, episodeComments.episodeId))
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(eq(episodeComments.id, commentId))
    .limit(1)
  if (!comment || (comment.writerId !== userId && comment.ownerId !== userId)) return false
  await db.delete(episodeComments).where(eq(episodeComments.id, commentId))
  return true
}
