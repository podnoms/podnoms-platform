import { createFileRoute } from '@tanstack/react-router'
import { shortPath } from '~/lib/paths'
import { getPublicEpisode } from '~/server/episodes.server'

// Where episodes' share pages used to be; they're at their short links now.
export const Route = createFileRoute('/listen/$slug/$episodeSlug')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const found = await getPublicEpisode(params.slug, params.episodeSlug, null)
        if (!found) return new Response('Not found', { status: 404 })
        const target = shortPath(found.episode.shortSlug) + new URL(request.url).search
        return new Response(null, { status: 301, headers: { Location: target, 'Cache-Control': 'public, max-age=86400' } })
      },
    },
  },
})
