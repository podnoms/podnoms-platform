import { z } from 'zod'
import { chatGifSchema } from '~/lib/gifs'

// The longest chat message, in characters.
export const chatMessageMaxLength = 500
export const liveTitleMaxLength = 200

export const livePodcastSchema = z.object({ podcastId: z.string().min(1) })

export const liveTitleSchema = z.object({
  podcastId: z.string().min(1),
  title: z.string().trim().max(liveTitleMaxLength),
})

// A message is some text, a GIF, or both.
export const postChatSchema = z
  .object({
    broadcastId: z.string().min(1),
    body: z.string().trim().max(chatMessageMaxLength).default(''),
    gif: chatGifSchema.optional(),
  })
  .refine((message) => message.body || message.gif, { message: 'Write something first', path: ['body'] })

export const endBroadcastSchema = z.object({ broadcastId: z.string().min(1) })

export const deleteChatSchema = z.object({ messageId: z.string().min(1) })
