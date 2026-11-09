import { createFileRoute } from '@tanstack/react-router'
import { getEpisodeWaveform } from '~/server/episodes.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// The episode's waveform for the app's player, as the site's player bar has
// it (episodes.server.ts): bar heights from 0 to 255, or null if it hasn't been
// made yet or the user may not see the episode.
export const Route = createFileRoute('/api/mobile/episodes/$id/waveform')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        return Response.json(await getEpisodeWaveform(userId, params.id))
      },
    },
  },
})
