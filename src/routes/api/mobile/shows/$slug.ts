import { createFileRoute } from '@tanstack/react-router'
import { mobileEpisodePageSchema } from '~/lib/mobile-schema'
import { listEpisodes, listPublishedEpisodes } from '~/server/episodes.server'
import { liveShowIdsAmong } from '~/server/live.server'
import { mobileEpisode, mobilePublishedEpisode, mobileShow } from '~/server/mobile-api.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'
import { getPublicShow } from '~/server/shows.server'

// A show the user may see and a page of its episodes: as listeners see them,
// or if it's their own, in any state with live progress (the app asks again
// every few seconds while any are processing).
export const Route = createFileRoute('/api/mobile/shows/$slug')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const page = mobileEpisodePageSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
        if (!page.success) return new Response('Invalid page', { status: 400 })
        const show = await getPublicShow(params.slug, userId)
        if (!show) return new Response('Not found', { status: 404 })
        const isOwner = show.userId === userId
        const [episodes, live] = await Promise.all([
          isOwner
            ? listEpisodes(userId, show.id, page.data).then((rows) => rows.map((episode) => mobileEpisode(request, episode)))
            : listPublishedEpisodes(show.id, userId, page.data).then((rows) =>
                rows.map((episode) => mobilePublishedEpisode(request, episode)),
              ),
          liveShowIdsAmong([show.id]),
        ])
        return Response.json({
          show: {
            ...mobileShow(request, show, live.has(show.id)),
            author: show.author,
            isOwner,
            following: show.following,
            followerCount: show.followerCount,
          },
          episodes,
        })
      },
    },
  },
})
