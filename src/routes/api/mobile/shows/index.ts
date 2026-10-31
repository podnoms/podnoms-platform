import { createFileRoute } from '@tanstack/react-router'
import { liveShowIdsAmong } from '~/server/live.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'
import { mobileShow } from '~/server/mobile-api.server'
import { listShows } from '~/server/shows.server'

// The signed-in user's shows.
export const Route = createFileRoute('/api/mobile/shows/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const shows = await listShows(userId)
        const live = await liveShowIdsAmong(shows.map((show) => show.id))
        return Response.json(shows.map((show) => mobileShow(request, show, live.has(show.id))))
      },
    },
  },
})
