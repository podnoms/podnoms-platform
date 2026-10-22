import { z } from 'zod'
import { chatGifSchema } from '~/lib/gifs'

// The longest comment, in characters.
export const commentMaxLength = 1000

// Text, a GIF, or both.
export const addCommentSchema = z
  .object({
    episodeId: z.string().min(1),
    body: z.string().trim().max(commentMaxLength),
    gif: chatGifSchema.optional(),
    atSeconds: z.number().min(0),
    // Set for a reply: the comment it replies to.
    parentId: z.string().min(1).optional(),
  })
  .refine((comment) => comment.body || comment.gif, { message: 'Write something first', path: ['body'] })

export const deleteCommentSchema = z.object({ commentId: z.string().min(1) })

export const likeCommentSchema = z.object({ commentId: z.string().min(1), like: z.boolean() })

// What's been typed after an @, for suggesting users to mention.
export const mentionSearchSchema = z.object({ query: z.string().trim().min(1).max(60) })
