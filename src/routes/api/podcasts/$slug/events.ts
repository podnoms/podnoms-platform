import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { eventStreamHeaders, podcastEventStream } from '~/server/episode-stream.server'
import { getPodcastBySlug } from '~/server/podcasts.server'

// Server-sent events about the podcast's episodes while they're processed, for
// its owner: progress as it changes, and when an episode's details change.
export const Route = createFileRoute('/api/podcasts/$slug/events')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await getSession(request)
        if (!session?.user?.id) return new Response('You need to be signed in', { status: 401 })
        const podcast = await getPodcastBySlug(session.user.id, params.slug)
        if (!podcast) return new Response('Not found', { status: 404 })
        return new Response(podcastEventStream(podcast.id, request.signal), { headers: eventStreamHeaders })
      },
    },
  },
})
