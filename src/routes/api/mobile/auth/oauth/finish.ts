import { createFileRoute } from '@tanstack/react-router'
import { mobileOAuthStartSchema } from '~/lib/mobile-schema'
import { finishMobileOAuth, isMobileRedirect } from '~/server/mobile-auth.server'

// Where Auth.js sends the browser after a provider sign-in started by the
// app: back to the app with a one-time code.
export const Route = createFileRoute('/api/mobile/auth/oauth/finish')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const parsed = mobileOAuthStartSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
        if (!parsed.success || !isMobileRedirect(parsed.data.redirect_uri)) {
          return new Response('Invalid sign-in request', { status: 400 })
        }
        const location = await finishMobileOAuth(request, {
          redirectUri: parsed.data.redirect_uri,
          codeChallenge: parsed.data.code_challenge,
        })
        return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } })
      },
    },
  },
})
