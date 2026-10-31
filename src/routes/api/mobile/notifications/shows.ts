import { createFileRoute } from '@tanstack/react-router'
import { mobileShowNotifySchema } from '~/lib/mobile-schema'
import { setFollowNotify } from '~/server/follower-notifications.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Mutes or unmutes a show the user follows, for every kind of notification,
// as on the site.
export const Route = createFileRoute('/api/mobile/notifications/shows')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const parsed = mobileShowNotifySchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid show', { status: 400 })
        if (!(await setFollowNotify(userId, parsed.data.showId, parsed.data.notify))) {
          return new Response('Not found', { status: 404 })
        }
        return new Response(null, { status: 204 })
      },
    },
  },
})
