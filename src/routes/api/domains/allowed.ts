import { createFileRoute } from '@tanstack/react-router'
import { normalizeDomain } from '~/lib/custom-domain'
import { podcastForDomain } from '~/server/custom-domains.server'

// Asked by the edge container (Caddy's on_demand_tls "ask") before it gets a
// certificate for a domain: 200 only for a podcast's verified custom domain.
export const Route = createFileRoute('/api/domains/allowed')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const domain = normalizeDomain(new URL(request.url).searchParams.get('domain') ?? '')
        const allowed = domain !== null && (await podcastForDomain(domain)) !== null
        return new Response(allowed ? 'OK' : 'Not a verified domain', { status: allowed ? 200 : 404 })
      },
    },
  },
})
