import { createFileRoute } from '@tanstack/react-router'
import { mobileChatSchema } from '~/lib/mobile-schema'
import { addChatMessage, ChatTooFastError } from '~/server/live.server'
import { mobileChatMessage } from '~/server/mobile-api.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Posts to the chat of a broadcast that's live, as on the site. 404 once it's ended.
export const Route = createFileRoute('/api/mobile/broadcasts/$id/chat')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const parsed = mobileChatSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response(parsed.error.issues[0]?.message ?? 'Invalid message', { status: 400 })
        try {
          const message = await addChatMessage(userId, params.id, parsed.data.body, parsed.data.gif)
          if (!message) return new Response('This broadcast has ended', { status: 404 })
          return Response.json(mobileChatMessage(request, message), { status: 201 })
        } catch (error) {
          if (error instanceof ChatTooFastError) return new Response(error.message, { status: 429 })
          throw error
        }
      },
    },
  },
})
