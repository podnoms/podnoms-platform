import { createFileRoute } from '@tanstack/react-router'
import { listLiveSlugs } from '~/server/live.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// The slugs of the shows the user may see that are live right now. Small, as
// the app asks every few seconds to keep its live badges up to date.
export const Route = createFileRoute('/api/mobile/live/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        return Response.json({ slugs: await listLiveSlugs(userId) })
      },
    },
  },
})
