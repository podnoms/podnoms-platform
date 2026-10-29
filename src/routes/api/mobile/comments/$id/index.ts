import { createFileRoute } from '@tanstack/react-router'
import { deleteComment } from '~/server/comments.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Deletes a comment the user wrote, or one on their own podcast, with its replies.
export const Route = createFileRoute('/api/mobile/comments/$id/')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        if (!(await deleteComment(userId, params.id))) return new Response('Not found', { status: 404 })
        return new Response(null, { status: 204 })
      },
    },
  },
})
