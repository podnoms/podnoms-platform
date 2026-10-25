import { createFileRoute } from '@tanstack/react-router'
import { brandIconUrl } from '~/lib/branding'
import { getBranding } from '~/server/branding.server'

// The web app manifest, for adding the site to a home screen, in its branding.
export const Route = createFileRoute('/site.webmanifest')({
  server: {
    handlers: {
      GET: async () => {
        const branding = await getBranding()
        const manifest = {
          name: branding.name,
          short_name: branding.name,
          description: branding.description,
          start_url: '/',
          icons: ([192, 512] as const).map((size) => ({ src: brandIconUrl(branding, size), sizes: `${size}x${size}`, type: 'image/png' })),
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
        }
        return Response.json(manifest, {
          headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' },
        })
      },
    },
  },
})
