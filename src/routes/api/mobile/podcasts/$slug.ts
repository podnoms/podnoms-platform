import { createFileRoute } from '@tanstack/react-router'
import { mobileEpisodePageSchema } from '~/lib/mobile-schema'
import { listEpisodes } from '~/server/episodes.server'
import { mobileEpisode, mobilePodcast } from '~/server/mobile-api.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'
import { getPodcastBySlug } from '~/server/podcasts.server'

// One of the user's podcasts and a page of its episodes, in any state, with
// live progress. The app asks again every few seconds while any are processing.
export const Route = createFileRoute('/api/mobile/podcasts/$slug')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const page = mobileEpisodePageSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
        if (!page.success) return new Response('Invalid page', { status: 400 })
        const podcast = await getPodcastBySlug(userId, params.slug)
        if (!podcast) return new Response('Not found', { status: 404 })
        const episodes = await listEpisodes(userId, podcast.id, page.data)
        return Response.json({
          podcast: mobilePodcast(request, podcast),
          episodes: episodes.map((episode) => mobileEpisode(request, episode)),
        })
      },
    },
  },
})
