import { createFileRoute } from '@tanstack/react-router'
import { mobileSignInSchema } from '~/lib/mobile-schema'
import { startMobileSignIn } from '~/server/mobile-auth.server'

// Signs the mobile app in with an email and password: a token, or a
// challenge to answer at /api/mobile/auth/two-factor.
export const Route = createFileRoute('/api/mobile/auth/sign-in')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = mobileSignInSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response(parsed.error.issues[0]?.message ?? 'Invalid sign-in', { status: 400 })
        const { email, password, deviceName } = parsed.data
        const result = await startMobileSignIn(email, password, deviceName)
        if (result.status === 'refused') return new Response("That email and password don't match", { status: 401 })
        return Response.json(result)
      },
    },
  },
})
