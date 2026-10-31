import { createFileRoute } from '@tanstack/react-router'
import { mobileHome } from '~/server/mobile-api.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// The app's home page. It asks again every so often, to see shows go live.
export const Route = createFileRoute('/api/mobile/home')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        return Response.json(await mobileHome(request, userId))
      },
    },
  },
})
