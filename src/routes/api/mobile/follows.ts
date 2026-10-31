import { createFileRoute } from '@tanstack/react-router'
import { followShowSchema } from '~/lib/library-schema'
import { setShowFollow } from '~/server/library.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Follows or unfollows a show the user may see, as on the site.
export const Route = createFileRoute('/api/mobile/follows')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const parsed = followShowSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid follow', { status: 400 })
        const result = await setShowFollow(userId, parsed.data.showId, parsed.data.following)
        if (!result) return new Response('Not found', { status: 404 })
        return Response.json(result)
      },
    },
  },
})
