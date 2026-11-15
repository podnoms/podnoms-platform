import { createFileRoute } from '@tanstack/react-router'
import { mobilePlayedSchema } from '~/lib/mobile-schema'
import { setEpisodePlayed } from '~/server/episodes.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Marks an episode as played, or as not played: the app leaves played ones
// out of a show's list unless asked for them.
export const Route = createFileRoute('/api/mobile/episodes/$id/played')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const parsed = mobilePlayedSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid played', { status: 400 })
        if (!(await setEpisodePlayed(userId, params.id, parsed.data.played))) {
          return new Response('Not found', { status: 404 })
        }
        return Response.json({ played: parsed.data.played })
      },
    },
  },
})
