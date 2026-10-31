import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { fetchLiveHls, getWatchableShowCached, hlsFileName, liveEnabled } from '~/server/live.server'

// The show's live video, as HLS from MediaMTX, for those who may watch it
// (anyone, unless the show is private). 404 while it isn't live.
export const Route = createFileRoute('/api/shows/$slug/live/hls/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const file = params._splat ?? ''
        if (!liveEnabled() || !hlsFileName.test(file)) return new Response('Not found', { status: 404 })
        const viewerId = (await getSession(request))?.user?.id ?? null
        const show = await getWatchableShowCached(params.slug, viewerId)
        if (!show) return new Response('Not found', { status: 404 })
        return fetchLiveHls(show.id, file, new URL(request.url).search, request.signal)
      },
    },
  },
})
