import { createFileRoute } from '@tanstack/react-router'
import { feedPath } from '~/lib/paths'
import { asShowRef } from '~/lib/show-schema'
import { publicUrl } from '~/server/site-url.server'
import { buildShowFeed } from '~/server/feed.server'
import { movedShow } from '~/server/shows.server'

// A show's RSS feed, which listeners subscribe to in their podcast app. If
// its owner or it has a new slug, the old URL redirects (permanently, which
// podcast apps take as the feed having moved), keeping its key.
export const Route = createFileRoute('/$user_/$show_/feed')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url)
        const ref = asShowRef(params)
        const xml = await buildShowFeed(ref, publicUrl(request).origin, { key: url.searchParams.get('key') })
        if (!xml) {
          const moved = await movedShow(ref)
          if (!moved) return new Response('Not found', { status: 404 })
          return new Response(null, { status: 301, headers: { Location: feedPath(moved) + url.search } })
        }
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
