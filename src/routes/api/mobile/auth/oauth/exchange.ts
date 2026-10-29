import { createFileRoute } from '@tanstack/react-router'
import { mobileOAuthExchangeSchema } from '~/lib/mobile-schema'
import { exchangeMobileOAuthCode } from '~/server/mobile-auth.server'

// The app trades the code from oauth/finish for a token, or a challenge to
// answer at auth/two-factor.
export const Route = createFileRoute('/api/mobile/auth/oauth/exchange')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = mobileOAuthExchangeSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid sign-in', { status: 400 })
        const { code, codeVerifier, deviceName } = parsed.data
        const result = await exchangeMobileOAuthCode(code, codeVerifier, deviceName)
        if (!result) return new Response('That sign-in has expired. Please try again.', { status: 401 })
        return Response.json(result)
      },
    },
  },
})
