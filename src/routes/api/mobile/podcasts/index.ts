import { createFileRoute } from '@tanstack/react-router'
import { mobileApiUserId } from '~/server/mobile-auth.server'
import { mobilePodcast } from '~/server/mobile-api.server'
import { listPodcasts } from '~/server/podcasts.server'

// The signed-in user's podcasts.
export const Route = createFileRoute('/api/mobile/podcasts/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const podcasts = await listPodcasts(userId)
        return Response.json(podcasts.map((podcast) => mobilePodcast(request, podcast)))
      },
    },
  },
})
