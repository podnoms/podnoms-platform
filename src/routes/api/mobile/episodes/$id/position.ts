import { createFileRoute } from '@tanstack/react-router'
import { mobilePositionSchema } from '~/lib/mobile-schema'
import { savePlaybackPosition } from '~/server/episodes.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Where the user left off in an episode, so the site and app both resume there.
export const Route = createFileRoute('/api/mobile/episodes/$id/position')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const parsed = mobilePositionSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid position', { status: 400 })
        if (!(await savePlaybackPosition(userId, params.id, parsed.data.seconds))) {
          return new Response('Not found', { status: 404 })
        }
        return new Response(null, { status: 204 })
      },
    },
  },
})
