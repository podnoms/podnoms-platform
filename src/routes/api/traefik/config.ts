import { createFileRoute } from '@tanstack/react-router'
import { configHash, traefikAuthorized, traefikConfig } from '~/server/custom-domains.server'

// Routers for custom domains, polled by Traefik's HTTP provider (see
// traefikConfig in custom-domains.server.ts and the README).
export const Route = createFileRoute('/api/traefik/config')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!traefikAuthorized(request)) return new Response('Unauthorized', { status: 401 })
        const body = JSON.stringify(await traefikConfig())
        const etag = `"${configHash(body)}"`
        if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } })
        return new Response(body, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ETag: etag },
        })
      },
    },
  },
})
