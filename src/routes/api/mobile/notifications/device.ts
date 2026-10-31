import { createFileRoute } from '@tanstack/react-router'
import { mobilePushDeviceSchema } from '~/lib/mobile-schema'
import { setMobilePushToken, mobileApiUserId } from '~/server/mobile-auth.server'

// Where to send this device's notifications, or null to stop. Goes by the
// token the request carries, so signing out ends them too.
export const Route = createFileRoute('/api/mobile/notifications/device')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const parsed = mobilePushDeviceSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid push token', { status: 400 })
        await setMobilePushToken(request, parsed.data.pushToken)
        return new Response(null, { status: 204 })
      },
    },
  },
})
