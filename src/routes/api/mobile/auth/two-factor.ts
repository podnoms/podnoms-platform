import { createFileRoute } from '@tanstack/react-router'
import { mobileTwoFactorSchema } from '~/lib/mobile-schema'
import { finishMobileSignIn } from '~/server/mobile-auth.server'
import { publicUrl } from '~/server/site-url.server'

// The second step of signing the mobile app in: an authenticator or recovery
// code for the challenge from /api/mobile/auth/sign-in.
export const Route = createFileRoute('/api/mobile/auth/two-factor')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = mobileTwoFactorSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response(parsed.error.issues[0]?.message ?? 'Invalid code', { status: 400 })
        const { challenge, method, code } = parsed.data
        const result = await finishMobileSignIn(challenge, { method, code }, publicUrl(request))
        if (!result.ok) return new Response(result.error, { status: result.expired ? 410 : 401 })
        return Response.json({ status: 'signed-in', token: result.token })
      },
    },
  },
})
