import { createFileRoute } from '@tanstack/react-router'
import { fetchLiveHls, getWatchableShowCached, hlsFileName, liveEnabled } from '~/server/live.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// The show's live video, as HLS from MediaMTX, by the app's token rather than
// the cookie the site's own proxy goes by. 404 while it isn't live.
export const Route = createFileRoute('/api/mobile/live/$slug/hls/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const file = params._splat ?? ''
        if (!liveEnabled() || !hlsFileName.test(file)) return new Response('Not found', { status: 404 })
        const show = await getWatchableShowCached(params.slug, userId)
        if (!show) return new Response('Not found', { status: 404 })
        return fetchLiveHls(show.id, file, new URL(request.url).search, request.signal)
      },
    },
  },
})
