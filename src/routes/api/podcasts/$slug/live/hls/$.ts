import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { fetchLiveHls, getWatchablePodcastCached, hlsFileName, liveEnabled } from '~/server/live.server'

// The podcast's live video, as HLS from MediaMTX, for those who may watch it
// (anyone, unless the podcast is private). 404 while it isn't live.
export const Route = createFileRoute('/api/podcasts/$slug/live/hls/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const file = params._splat ?? ''
        if (!liveEnabled() || !hlsFileName.test(file)) return new Response('Not found', { status: 404 })
        const viewerId = (await getSession(request))?.user?.id ?? null
        const podcast = await getWatchablePodcastCached(params.slug, viewerId)
        if (!podcast) return new Response('Not found', { status: 404 })
        return fetchLiveHls(podcast.id, file, new URL(request.url).search, request.signal)
      },
    },
  },
})
