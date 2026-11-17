import { createFileRoute } from '@tanstack/react-router'
import { linkEpisodeSchema } from '~/lib/episode-schema'
import { createEpisode, FollowsChannelError } from '~/server/episodes.server'
import { catchAudioLimit } from '~/server/subscriptions.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Adds an episode from a link (typed in, or shared to the app), downloaded in
// the background like one added on the site.
const mobileEpisodeSchema = linkEpisodeSchema.pick({ showId: true, sourceUrl: true })

export const Route = createFileRoute('/api/mobile/episodes/')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const parsed = mobileEpisodeSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response(parsed.error.issues[0]?.message ?? 'Invalid episode', { status: 400 })
        let result
        try {
          result = await catchAudioLimit(() => createEpisode(userId, parsed.data))
        } catch (error) {
          // A show following a channel or playlist takes no episodes by hand.
          if (error instanceof FollowsChannelError) return new Response(error.message, { status: 409 })
          throw error
        }
        if ('error' in result) return new Response(result.error, { status: 403 })
        const episode = result.value
        if (!episode) return new Response('Show not found', { status: 404 })
        return Response.json({ id: episode.id, slug: episode.slug }, { status: 201 })
      },
    },
  },
})
