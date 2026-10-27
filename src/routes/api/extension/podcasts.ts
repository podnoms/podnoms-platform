import { createFileRoute } from '@tanstack/react-router'
import { podcastPath } from '~/lib/paths'
import { extensionUserId, siteUrl } from '~/server/extension-api.server'
import { listPodcasts } from '~/server/podcasts.server'

// The signed-in user's podcasts, for the browser extension to offer as places
// to send what's on a page.
export const Route = createFileRoute('/api/extension/podcasts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await extensionUserId(request)
        if (userId instanceof Response) return userId
        const podcasts = await listPodcasts(userId)
        return Response.json(
          podcasts.map((podcast) => ({
            id: podcast.id,
            slug: podcast.slug,
            title: podcast.title,
            imageUrl: podcast.imageUrl && siteUrl(request, podcast.imageUrl),
            url: siteUrl(request, podcastPath(podcast.slug)),
          })),
        )
      },
    },
  },
})
