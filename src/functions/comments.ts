// Server functions for commenting on episodes. Comments are read along with
// the episode's page (see fetchEpisodePage).
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { addCommentSchema, deleteCommentSchema } from '~/lib/comment-schema'
import { getSession } from '~/server/auth.server'
import { addComment, deleteComment } from '~/server/comments.server'

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
    const comments = await addComment(await requireUserId(), data.episodeId, data.body, data.atSeconds)
    if (!comments) throw notFound()
    return comments
  })

export const removeComment = createServerFn({ method: 'POST' })
  .validator(deleteCommentSchema)
  .handler(async ({ data }) => {
    if (!(await deleteComment(await requireUserId(), data.commentId))) throw notFound()
  })
