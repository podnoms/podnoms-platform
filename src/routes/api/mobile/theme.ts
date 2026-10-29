import { createHash } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { mobileTheme } from '~/server/mobile-api.server'

// The site's theme for the app, so it looks like the site; anyone may see it,
// as the sign-in screen is themed too. Admins can change it at any time, and
// the app asks again often, so it isn't cached: an unchanged theme costs a
// 304 (the ETag) instead.
export const Route = createFileRoute('/api/mobile/theme')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const body = JSON.stringify(await mobileTheme())
        const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`
        const headers = { 'content-type': 'application/json', 'cache-control': 'no-cache', etag }
        if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
        return new Response(body, { headers })
      },
    },
  },
})
