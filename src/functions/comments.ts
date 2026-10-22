// Server functions for commenting on episodes. Comments are read along with
// the episode's page (see fetchEpisodePage).
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { addCommentSchema, deleteCommentSchema, likeCommentSchema, mentionSearchSchema } from '~/lib/comment-schema'
import { getSession } from '~/server/auth.server'
import { addComment, deleteComment, setCommentLike } from '~/server/comments.server'
import { searchUsers } from '~/server/users.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  const userId = session?.user?.id
  if (!userId) throw new Error('You need to be signed in')
  return userId
}

// Returns the episode's comments, the new one among them.
export const postComment = createServerFn({ method: 'POST' })
  .validator(addCommentSchema)
  .handler(async ({ data }) => {
    const { episodeId, body, atSeconds, parentId, gif } = data
    const comments = await addComment(await requireUserId(), episodeId, body, atSeconds, parentId, gif)
    if (!comments) throw notFound()
    return comments
  })

export const removeComment = createServerFn({ method: 'POST' })
  .validator(deleteCommentSchema)
  .handler(async ({ data }) => {
    if (!(await deleteComment(await requireUserId(), data.commentId))) throw notFound()
  })

// Returns the comment's like count and whether the user likes it.
export const likeComment = createServerFn({ method: 'POST' })
  .validator(likeCommentSchema)
  .handler(async ({ data }) => {
    const result = await setCommentLike(await requireUserId(), data.commentId, data.like)
    if (!result) throw notFound()
    return result
  })

// Users to suggest after an @, for signed-in users writing a comment.
export const searchMentions = createServerFn({ method: 'GET' })
  .validator(mentionSearchSchema)
  .handler(async ({ data }) => {
    await requireUserId()
    return searchUsers(data.query)
  })
