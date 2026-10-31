import { createFileRoute } from '@tanstack/react-router'
import { mobileNotificationPrefsSchema } from '~/lib/mobile-schema'
import { updateAppPushPrefs } from '~/server/app-push.server'
import { mobileNotificationSettings } from '~/server/mobile-api.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Which notifications the user gets on the app, and the shows they could
// hear about. Saving gives them back as they now are.
export const Route = createFileRoute('/api/mobile/notifications/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        return Response.json(await mobileNotificationSettings(request, userId))
      },
      POST: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const parsed = mobileNotificationPrefsSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid settings', { status: 400 })
        await updateAppPushPrefs(userId, parsed.data)
        return Response.json(await mobileNotificationSettings(request, userId))
      },
    },
  },
})
