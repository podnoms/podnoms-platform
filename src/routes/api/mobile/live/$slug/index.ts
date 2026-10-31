import { createFileRoute } from '@tanstack/react-router'
import { mobileLivePage } from '~/server/mobile-api.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// A show's live page, for anyone who may see the show. The app asks again
// every few seconds, which is also how it follows the chat and counts as watching.
export const Route = createFileRoute('/api/mobile/live/$slug/')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const page = await mobileLivePage(request, userId, params.slug)
        if (!page) return new Response('Not found', { status: 404 })
        return Response.json(page)
      },
    },
  },
})
