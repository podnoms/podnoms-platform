import { createFileRoute } from '@tanstack/react-router'
import { reportedActivitySchema } from '~/lib/activity-schema'
import { recordActivity } from '~/server/activity.server'

// Where browsers report plays and shares (see src/lib/activity.ts), for the
// podcast's stats. Always answers 204 for a valid report, recorded or not, so
// it says nothing about what's counted.
export const Route = createFileRoute('/api/episodes/$id/activity')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const parsed = reportedActivitySchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid activity', { status: 400 })
        await recordActivity(request, { episodeId: params.id, ...parsed.data })
        return new Response(null, { status: 204 })
      },
    },
  },
})
