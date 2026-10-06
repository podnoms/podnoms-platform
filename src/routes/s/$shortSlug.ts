import { createFileRoute } from '@tanstack/react-router'
import { listenPath } from '~/lib/paths'
import { findShortLink } from '~/server/episodes.server'

// An episode's short link, for sharing: sends listeners on to its listen page.
// A temporary redirect, so the listen page's address is free to change.
export const Route = createFileRoute('/s/$shortSlug')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const found = await findShortLink(params.shortSlug.toLowerCase())
        if (!found) return new Response('Not found', { status: 404 })
        return new Response(null, {
          status: 302,
          headers: { Location: listenPath(found.slug, found.episodeSlug), 'Cache-Control': 'public, max-age=300' },
        })
      },
    },
  },
})
