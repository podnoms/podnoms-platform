import { createFileRoute } from '@tanstack/react-router'
import { authorizeLive, isLiveSecret, liveTokenFrom, type LiveAuthRequest } from '~/server/live.server'

// MediaMTX's HTTP authentication (see live.server.ts): it posts each publish
// and read here, with LIVE_SECRET as ?token=, and lets it through on a 200.
export const Route = createFileRoute('/api/live/auth')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isLiveSecret(liveTokenFrom(request.url))) {
          return new Response('Unauthorized', { status: 401 })
        }
        const body = (await request.json().catch(() => null)) as LiveAuthRequest | null
        const allowed = body !== null && typeof body === 'object' && (await authorizeLive(body))
        return new Response(null, { status: allowed ? 200 : 401 })
      },
    },
  },
})
