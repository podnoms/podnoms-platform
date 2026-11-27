import { createFileRoute } from '@tanstack/react-router'
import { reportedActivitySchema } from '~/lib/activity-schema'
import { recordActivity } from '~/server/activity.server'
import { requestUserId } from '~/server/mobile-auth.server'

// Where browsers report plays and shares (see src/lib/activity.ts), for the
// show's stats. Always answers 204 for a valid report, recorded or not, so
// it says nothing about what's counted. Signed-in users' (by cookie, or the
// app's token) also go into their listening history.
export const Route = createFileRoute('/api/episodes/$id/activity')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const parsed = reportedActivitySchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid activity', { status: 400 })
        await recordActivity(request, { episodeId: params.id, ...parsed.data }, await requestUserId(request))
        return new Response(null, { status: 204 })
      },
    },
  },
})
