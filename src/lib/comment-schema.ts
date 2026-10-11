import { z } from 'zod'

// The longest comment, in characters.
export const commentMaxLength = 1000

export const addCommentSchema = z.object({
  episodeId: z.string().min(1),
  body: z.string().trim().min(1, 'Write something first').max(commentMaxLength),
  atSeconds: z.number().min(0),
})

export const deleteCommentSchema = z.object({ commentId: z.string().min(1) })
