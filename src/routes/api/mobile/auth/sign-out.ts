import { createFileRoute } from '@tanstack/react-router'
import { requestMobileToken, revokeMobileToken } from '~/server/mobile-auth.server'

// Signs the mobile app out: its token stops working.
export const Route = createFileRoute('/api/mobile/auth/sign-out')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = requestMobileToken(request)
        if (token) await revokeMobileToken(token)
        return new Response(null, { status: 204 })
      },
    },
  },
})
