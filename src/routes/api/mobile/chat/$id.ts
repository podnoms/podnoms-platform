import { createFileRoute } from '@tanstack/react-router'
import { deleteChatMessage } from '~/server/live.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Deletes a chat message the user wrote, or one on their own show's broadcast.
export const Route = createFileRoute('/api/mobile/chat/$id')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        if (!(await deleteChatMessage(userId, params.id))) return new Response('Not found', { status: 404 })
        return new Response(null, { status: 204 })
      },
    },
  },
})
