import { createFileRoute } from '@tanstack/react-router'
import { trackedLinkVisitSchema } from '~/lib/tracked-link-schema'
import { getSession } from '~/server/auth.server'
import { recordTrackedLinkVisit } from '~/server/tracked-links.server'

// Where a share page opened through a tracked link reports the open, and the
// first play (see tracked-links.server.ts). Always answers 204 for a valid
// report, counted or not, so it says nothing about which tokens exist.
export const Route = createFileRoute('/api/tracked-links/$token')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const parsed = trackedLinkVisitSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid visit', { status: 400 })
        const session = await getSession(request)
        await recordTrackedLinkVisit(params.token, parsed.data, {
          userAgent: request.headers.get('user-agent'),
          viewerId: session?.user?.id ?? null,
        })
        return new Response(null, { status: 204 })
      },
    },
  },
})
