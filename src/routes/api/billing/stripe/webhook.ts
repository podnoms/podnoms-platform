import { createFileRoute } from '@tanstack/react-router'
import { getStripeConfig } from '~/server/billing-config.server'
import { InvalidWebhookError, handleStripeWebhook } from '~/server/stripe.server'

// Stripe telling us about subscriptions (see stripe.server.ts).
export const Route = createFileRoute('/api/billing/stripe/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await getStripeConfig())) return new Response('Not found', { status: 404 })
        try {
          await handleStripeWebhook(await request.text(), request.headers.get('stripe-signature'))
        } catch (error) {
          if (error instanceof InvalidWebhookError) return new Response('Invalid signature', { status: 400 })
          throw error
        }
        return new Response(null, { status: 204 })
      },
    },
  },
})
