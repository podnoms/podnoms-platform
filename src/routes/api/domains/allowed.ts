import { createFileRoute } from '@tanstack/react-router'
import { normalizeDomain } from '~/lib/custom-domain'
import { redirectingTo, showForDomain } from '~/server/custom-domains.server'

// Asked by the edge container (Caddy's on_demand_tls "ask") before it gets a
// certificate for a domain: 200 only for a show's verified custom domain, or
// the root or www that redirects to it.
export const Route = createFileRoute('/api/domains/allowed')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const domain = normalizeDomain(new URL(request.url).searchParams.get('domain') ?? '')
        const allowed = domain !== null && ((await showForDomain(domain)) !== null || (await redirectingTo(domain)) !== null)
        return new Response(allowed ? 'OK' : 'Not a verified domain', { status: allowed ? 200 : 404 })
      },
    },
  },
})
