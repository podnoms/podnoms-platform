import { createFileRoute } from '@tanstack/react-router'
import { publicUrl } from '~/server/auth.server'
import { buildSitemap, listSitemapEntries } from '~/server/sitemap.server'

// The sitemap, for search engines (see robots.txt).
export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async ({ request }) =>
        new Response(buildSitemap(await listSitemapEntries(), publicUrl(request).origin), {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
    },
  },
})
