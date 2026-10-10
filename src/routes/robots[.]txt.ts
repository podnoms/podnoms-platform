import { createFileRoute } from '@tanstack/react-router'
import { publicUrl } from '~/server/site-url.server'

// What crawlers may fetch. Pages that need a signed-in user say noindex
// themselves, and only redirect a crawler anyway. Behind Cloudflare's managed
// robots.txt, its content signals are added above these rules. Episode audio
// stays fetchable, as the episode pages' structured data points to it. Share
// pages (/s/) are fetchable for link previews; they name the episode page as
// the one to index.
const allowed = ['/', '/api/episodes/*/audio']
const disallowed = ['/api/', '/_serverFn/', '/admin', '/settings', '/security', '/embed/', '/listen/', '/reset-password']

export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(
          [
            'User-agent: *',
            ...allowed.map((path) => `Allow: ${path}`),
            ...disallowed.map((path) => `Disallow: ${path}`),
            '',
            `Sitemap: ${new URL('/sitemap.xml', publicUrl(request).origin)}`,
            '',
          ].join('\n'),
          { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } },
        ),
    },
  },
})
