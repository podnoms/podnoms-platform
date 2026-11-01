import { createFileRoute } from '@tanstack/react-router'
import { getPatreonConfig } from '~/server/billing-config.server'
import { handlePatreonWebhook, validPatreonSignature } from '~/server/patreon.server'

// Patreon telling us about pledges (see patreon.server.ts).
export const Route = createFileRoute('/api/billing/patreon/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await getPatreonConfig())) return new Response('Not found', { status: 404 })
        const body = await request.text()
        if (!(await validPatreonSignature(body, request.headers.get('x-patreon-signature')))) {
          return new Response('Invalid signature', { status: 400 })
        }
        await handlePatreonWebhook(body, request.headers.get('x-patreon-event'))
        return new Response(null, { status: 204 })
      },
    },
  },
})
