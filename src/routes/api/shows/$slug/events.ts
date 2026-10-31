import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { eventStreamHeaders, showEventStream } from '~/server/episode-stream.server'
import { getShowBySlug } from '~/server/shows.server'

// Server-sent events about the show's episodes while they're processed, for
// its owner: progress as it changes, and when an episode's details change.
export const Route = createFileRoute('/api/shows/$slug/events')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await getSession(request)
        if (!session?.user?.id) return new Response('You need to be signed in', { status: 401 })
        const show = await getShowBySlug(session.user.id, params.slug)
        if (!show) return new Response('Not found', { status: 404 })
        return new Response(showEventStream(show.id, request.signal), { headers: eventStreamHeaders })
      },
    },
  },
})
