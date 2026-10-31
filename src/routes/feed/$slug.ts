import { createFileRoute } from '@tanstack/react-router'
import { publicUrl } from '~/server/site-url.server'
import { buildShowFeed } from '~/server/feed.server'

// A show's RSS feed, which listeners subscribe to in their podcast app.
export const Route = createFileRoute('/feed/$slug')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const key = new URL(request.url).searchParams.get('key')
        const xml = await buildShowFeed(params.slug, publicUrl(request).origin, { key })
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
