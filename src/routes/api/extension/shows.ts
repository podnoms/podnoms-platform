import { createFileRoute } from '@tanstack/react-router'
import { showPath } from '~/lib/paths'
import { extensionUserId, siteUrl } from '~/server/extension-api.server'
import { listShows } from '~/server/shows.server'

// The signed-in user's shows, for the browser extension to offer as places
// to send what's on a page: not those following a channel or playlist.
export const Route = createFileRoute('/api/extension/shows')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await extensionUserId(request)
        if (userId instanceof Response) return userId
        const shows = await listShows(userId, { takingEpisodes: true })
        return Response.json(
          shows.map((show) => ({
            id: show.id,
            slug: show.slug,
            title: show.title,
            imageUrl: show.imageUrl && siteUrl(request, show.imageUrl),
            url: siteUrl(request, showPath(show)),
          })),
        )
      },
    },
  },
})
