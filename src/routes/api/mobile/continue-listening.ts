import { createFileRoute } from '@tanstack/react-router'
import { listContinueListening } from '~/server/library.server'
import { mobileListenerEpisode } from '~/server/mobile-api.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Episodes the user started and hasn't finished, on the app or the site.
export const Route = createFileRoute('/api/mobile/continue-listening')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const episodes = await listContinueListening(userId, 20)
        return Response.json(episodes.map((episode) => mobileListenerEpisode(request, episode)))
      },
    },
  },
})
