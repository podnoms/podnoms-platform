// Telling users when someone mentions them in a comment, or replies to their
// comment: by desktop notification (push.server.ts) and in their next email
// (notifications.server.ts), as each chooses, and in their notifications menu
// (inbox.server.ts) either way. Never the comment's own author, nor anyone
// who can't see the episode (it may be private).
import '@tanstack/react-start/server-only'
import { and, eq } from 'drizzle-orm'
import { episodePath } from '~/lib/paths'
import { mentionsAsText, type CommentMentions } from '~/lib/user-slug'
import { db } from '~/server/db/client.server'
import { commentMentions, episodeComments, episodes, shows, users } from '~/server/db/schema'
import { emailOrigin } from '~/server/email.server'
import { visibleTo } from '~/server/episodes.server'
import { recordNotification } from '~/server/inbox.server'
import { reportError } from '~/server/logger.server'
import { emailCommentNotice } from '~/server/notifications.server'
import { sendPush } from '~/server/push.server'

const excerptLength = 140

const excerpt = (text: string) => (text.length > excerptLength ? `${text.slice(0, excerptLength - 1).trimEnd()}…` : text)

async function canSee(userId: string, episodeId: string) {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(and(eq(episodes.id, episodeId), visibleTo(userId)))
    .limit(1)
  return Boolean(row)
}

async function tell(commentId: string) {
  const [comment] = await db
    .select({
      body: episodeComments.body,
      gif: episodeComments.gif,
      parentId: episodeComments.parentId,
      authorId: episodeComments.userId,
      authorName: users.name,
      authorSlug: users.slug,
      authorImage: users.image,
      episodeId: episodes.id,
      episodeTitle: episodes.title,
      episodeSlug: episodes.slug,
      showTitle: shows.title,
      showSlug: shows.slug,
    })
    .from(episodeComments)
    .innerJoin(users, eq(users.id, episodeComments.userId))
    .innerJoin(episodes, eq(episodes.id, episodeComments.episodeId))
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(eq(episodeComments.id, commentId))
    .limit(1)
  if (!comment) return

  const mentioned = await db
    .select({ id: users.id, slug: users.slug, name: users.name })
    .from(commentMentions)
    .innerJoin(users, eq(users.id, commentMentions.userId))
    .where(eq(commentMentions.commentId, commentId))
  const mentions: CommentMentions = Object.fromEntries(mentioned.map((user) => [user.id, { slug: user.slug, name: user.name }]))
  // Whoever is mentioned hears about that; the thread's author, if not
  // mentioned, hears they were replied to.
  const recipients = new Map<string, 'mention' | 'reply'>(mentioned.map((user) => [user.id, 'mention']))
  if (comment.parentId) {
    const [parent] = await db
      .select({ userId: episodeComments.userId })
      .from(episodeComments)
      .where(eq(episodeComments.id, comment.parentId))
      .limit(1)
    if (parent && !recipients.has(parent.userId)) recipients.set(parent.userId, 'reply')
  }
  recipients.delete(comment.authorId)

  const authorName = comment.authorName ?? `@${comment.authorSlug}`
  // A comment can be just a GIF.
  const text = excerpt(mentionsAsText(comment.body, mentions)) || 'Sent a GIF'
  const path = `${episodePath(comment.showSlug, comment.episodeSlug)}#comment-${commentId}`
  const origin = emailOrigin()
  for (const [userId, kind] of recipients) {
    if (!(await canSee(userId, comment.episodeId))) continue
    const title = `${authorName} ${kind === 'mention' ? 'mentioned you' : 'replied to you'}`
    await recordNotification([userId], { kind, title, body: text, url: path, image: comment.authorImage })
    const [prefs] = await db
      .select({ push: users.pushMentions })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (prefs?.push)
      await sendPush([userId], {
        title,
        body: text,
        url: path,
        icon: comment.authorImage,
        tag: `comment-${commentId}`,
      })
    // Checks the user's email choice itself.
    emailCommentNotice(userId, {
      type: 'comment',
      kind,
      authorName,
      episodeTitle: comment.episodeTitle,
      showTitle: comment.showTitle,
      excerpt: text,
      link: origin ? new URL(path, origin).toString() : null,
    })
  }
}

// For a comment just made. Never gets in the way of making it.
export function notifyCommentRecipients(commentId: string) {
  void tell(commentId).catch((error: unknown) => reportError(error, { msg: 'Notifying about a comment failed', commentId }))
}
