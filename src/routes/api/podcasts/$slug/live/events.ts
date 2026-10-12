import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { eventStreamHeaders } from '~/server/episode-stream.server'
import { getWatchablePodcast, liveEnabled } from '~/server/live.server'
import { liveEventStream } from '~/server/live-stream.server'

// Server-sent events for the podcast's live page: the broadcast starting and
// ending, its chat, and how many are watching. For anyone who may see the
// podcast; live pages add ?watching=1 to be counted.
export const Route = createFileRoute('/api/podcasts/$slug/live/events')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!liveEnabled()) return new Response('Not found', { status: 404 })
        const viewerId = (await getSession(request))?.user?.id ?? null
        const podcast = await getWatchablePodcast(params.slug, viewerId)
        if (!podcast) return new Response('Not found', { status: 404 })
        const watching = new URL(request.url).searchParams.get('watching') === '1'
        return new Response(liveEventStream(podcast, viewerId, watching, request.signal), { headers: eventStreamHeaders })
      },
    },
  },
})
