import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { eventStreamHeaders } from '~/server/episode-stream.server'
import { getWatchableShow, liveEnabled } from '~/server/live.server'
import { liveEventStream } from '~/server/live-stream.server'

// Server-sent events for the show's live page: the broadcast starting and
// ending, its chat, and how many are watching. For anyone who may see the
// show; live pages add ?watching=1 to be counted.
export const Route = createFileRoute('/api/shows/$slug/live/events')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!liveEnabled()) return new Response('Not found', { status: 404 })
        const viewerId = (await getSession(request))?.user?.id ?? null
        const show = await getWatchableShow(params.slug, viewerId)
        if (!show) return new Response('Not found', { status: 404 })
        const watching = new URL(request.url).searchParams.get('watching') === '1'
        return new Response(liveEventStream(show, viewerId, watching, request.signal), { headers: eventStreamHeaders })
      },
    },
  },
})
