import { z } from 'zod'

// The longest chat message, in characters.
export const chatMessageMaxLength = 500
export const liveTitleMaxLength = 200

export const livePodcastSchema = z.object({ podcastId: z.string().min(1) })

export const liveTitleSchema = z.object({
  podcastId: z.string().min(1),
  title: z.string().trim().max(liveTitleMaxLength),
})

export const postChatSchema = z.object({
  broadcastId: z.string().min(1),
  body: z.string().trim().min(1, 'Write something first').max(chatMessageMaxLength),
})

export const deleteChatSchema = z.object({ messageId: z.string().min(1) })
