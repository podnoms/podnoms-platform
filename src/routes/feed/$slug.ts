import { createFileRoute } from '@tanstack/react-router'
import { publicUrl } from '~/server/site-url.server'
import { buildPodcastFeed } from '~/server/feed.server'

// A podcast's RSS feed, which listeners subscribe to in their podcast app.
export const Route = createFileRoute('/feed/$slug')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const xml = await buildPodcastFeed(params.slug, publicUrl(request).origin)
        if (!xml) return new Response('Not found', { status: 404 })
        return new Response(xml, {
          headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        })
      },
    },
  },
})
