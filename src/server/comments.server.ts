// Comments on episodes. Each is made at a point in the episode (where the
// listener was when they wrote it, or where they clicked the waveform), and
// they're listed in that order. A comment can have replies, one level deep:
// a reply to a reply joins the same thread. Only signed-in users can comment,
// reply or like a comment, on episodes they can see; a comment (with its
// replies) can be deleted by whoever wrote it or by the podcast's owner.
//
// @slug in a comment mentions that user: it's stored as <@userId> (see
// comment_mention), so it follows them if their slug changes, and they're
// told (see comment-notifications.server.ts), as is whoever is replied to.
import '@tanstack/react-start/server-only'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { ChatGif } from '~/lib/gifs'
import { mentionPattern, mentionedSlugs, storedMention, type CommentMentions } from '~/lib/user-slug'
import { notifyCommentRecipients } from '~/server/comment-notifications.server'
import { db } from '~/server/db/client.server'
import { commentLikes, commentMentions, episodeComments, episodes, podcasts, users } from '~/server/db/schema'
import { visibleTo } from '~/server/episodes.server'
import { usersBySlug } from '~/server/users.server'

// The episode, if the viewer can see it, with who owns its podcast.
export async function visibleEpisode(episodeId: string, viewerId: string | null) {
  const [episode] = await db
    .select({ id: episodes.id, durationSeconds: episodes.durationSeconds, ownerId: podcasts.userId })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(episodes.id, episodeId), visibleTo(viewerId)))
    .limit(1)
  return episode ?? null
}

// An episode's comments in the order they come in it (then oldest first),
// each with its replies (oldest first), who wrote it, its likes and the users
// it mentions, and whether the viewer may delete it. Empty if the viewer
// can't see the episode.
export async function listComments(episodeId: string, viewerId: string | null) {
  const episode = await visibleEpisode(episodeId, viewerId)
  if (!episode) return []
  const likeCount = sql<number>`(select count(*) from ${commentLikes} where ${commentLikes.commentId} = ${episodeComments.id})`.mapWith(Number)
  const liked = viewerId
    ? sql<boolean>`exists (select 1 from ${commentLikes} where ${commentLikes.commentId} = ${episodeComments.id} and ${commentLikes.userId} = ${viewerId})`
    : sql<boolean>`false`
  const rows = await db
    .select({
      id: episodeComments.id,
      parentId: episodeComments.parentId,
      body: episodeComments.body,
      gif: episodeComments.gif,
      atSeconds: episodeComments.atSeconds,
      createdAt: episodeComments.createdAt,
      userId: episodeComments.userId,
      author: { name: users.name, image: users.image, slug: users.slug },
      likeCount,
      liked,
    })
    .from(episodeComments)
    .innerJoin(users, eq(users.id, episodeComments.userId))
    .where(eq(episodeComments.episodeId, episodeId))
    .orderBy(asc(episodeComments.atSeconds), asc(episodeComments.createdAt), asc(episodeComments.id))
  const mentionRows = rows.length
    ? await db
        .select({ commentId: commentMentions.commentId, userId: users.id, slug: users.slug, name: users.name })
        .from(commentMentions)
        .innerJoin(users, eq(users.id, commentMentions.userId))
        .where(
          inArray(
            commentMentions.commentId,
            rows.map((row) => row.id),
          ),
        )
    : []
  // Who wrote them is shown by name and slug; their ids stay on the server.
  const comments = rows.map(({ userId, ...comment }) => ({
    ...comment,
    mentions: Object.fromEntries(
      mentionRows
        .filter((mention) => mention.commentId === comment.id)
        .map((mention) => [mention.userId, { slug: mention.slug, name: mention.name }]),
    ) as CommentMentions,
    canDelete: viewerId !== null && (userId === viewerId || episode.ownerId === viewerId),
  }))
  const replies = comments
    .filter((comment) => comment.parentId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  return comments
    .filter((comment) => !comment.parentId)
    .map((comment) => ({ ...comment, replies: replies.filter((reply) => reply.parentId === comment.id) }))
}

export type EpisodeComment = Awaited<ReturnType<typeof listComments>>[number]
export type CommentReply = EpisodeComment['replies'][number]

// Swaps the @slugs of users who exist for <@userId>, returning the body and
// who it mentions.
async function storeMentions(body: string) {
  const found = await usersBySlug(mentionedSlugs(body))
  const bySlug = new Map(found.map((user) => [user.slug, user.id]))
  const stored = body.replace(mentionPattern, (match, before: string, slug: string) => {
    const userId = bySlug.get(slug.toLowerCase())
    return userId ? `${before}${storedMention(userId)}` : match
  })
  return { body: stored, mentionedIds: [...new Set(bySlug.values())] }
}

// Adds a comment at `atSeconds` (kept within the episode), or a reply to
// `parentId` (at its thread's point), with text, a GIF or both. Returns the
// episode's comments, or null if there's no such episode, or comment to
// reply to, for the user, or nothing to say.
export async function addComment(
  userId: string,
  episodeId: string,
  body: string,
  atSeconds: number,
  parentId: string | null = null,
  gif: ChatGif | null = null,
) {
  if (!body.trim() && !gif) return null
  const episode = await visibleEpisode(episodeId, userId)
  if (!episode) return null
  let thread: { id: string; atSeconds: number } | null = null
  if (parentId) {
    const [parent] = await db
      .select({ id: episodeComments.id, parentId: episodeComments.parentId })
      .from(episodeComments)
      .where(and(eq(episodeComments.id, parentId), eq(episodeComments.episodeId, episodeId)))
      .limit(1)
    if (!parent) return null
    const [root] = await db
      .select({ id: episodeComments.id, atSeconds: episodeComments.atSeconds })
      .from(episodeComments)
      .where(eq(episodeComments.id, parent.parentId ?? parent.id))
      .limit(1)
    thread = root!
  }
  const end = episode.durationSeconds ?? Number.POSITIVE_INFINITY
  const stored = await storeMentions(body.trim())
  const [comment] = await db
    .insert(episodeComments)
    .values({
      episodeId,
      userId,
      parentId: thread?.id ?? null,
      body: stored.body,
      gif,
      atSeconds: thread?.atSeconds ?? Math.max(0, Math.min(Math.floor(atSeconds), Math.floor(end))),
    })
    .returning({ id: episodeComments.id })
  if (stored.mentionedIds.length)
    await db.insert(commentMentions).values(stored.mentionedIds.map((mentioned) => ({ commentId: comment!.id, userId: mentioned })))
  notifyCommentRecipients(comment!.id)
  return listComments(episodeId, userId)
}

// Likes or unlikes a comment on an episode the user can see. Returns its
// like count and whether the user likes it, or null if there's no such
// comment for them.
export async function setCommentLike(userId: string, commentId: string, like: boolean) {
  const [comment] = await db
    .select({ episodeId: episodeComments.episodeId })
    .from(episodeComments)
    .where(eq(episodeComments.id, commentId))
    .limit(1)
  if (!comment || !(await visibleEpisode(comment.episodeId, userId))) return null
  if (like) await db.insert(commentLikes).values({ userId, commentId }).onConflictDoNothing()
  else await db.delete(commentLikes).where(and(eq(commentLikes.userId, userId), eq(commentLikes.commentId, commentId)))
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(commentLikes)
    .where(eq(commentLikes.commentId, commentId))
  return { likeCount: row!.count, liked: like }
}

// Deletes a comment the user wrote, or one on their own podcast, with its
// replies. Returns whether one was deleted.
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
