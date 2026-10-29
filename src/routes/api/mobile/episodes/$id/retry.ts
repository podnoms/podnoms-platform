import { createFileRoute } from '@tanstack/react-router'
import { retryEpisode } from '~/server/episodes.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Queues one of the user's failed episodes to be downloaded again.
export const Route = createFileRoute('/api/mobile/episodes/$id/retry')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        if (!(await retryEpisode(userId, params.id))) return new Response("That episode can't be retried", { status: 409 })
        return new Response(null, { status: 204 })
      },
    },
  },
})
