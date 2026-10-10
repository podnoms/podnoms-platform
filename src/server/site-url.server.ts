// The site's public address. SITE_URL says what it is; without it, it's taken
// from each request, which is right unless a proxy in front of the app doesn't
// pass on the original protocol and host. Things done outside a request (emails
// from background jobs) can only use SITE_URL.
import '@tanstack/react-start/server-only'
import { env } from '~/env'

// The site's origin (e.g. https://podnoms.com) when it's configured, else null.
export function siteOrigin() {
  return env.SITE_URL ? new URL(env.SITE_URL).origin : null
}

// The request's URL as visitors see it: on SITE_URL's protocol, host and
// port, if it's set. Sign-in uses this too (see auth.server.ts).
export function publicUrl(request: Request) {
  const url = new URL(request.url)
  if (env.SITE_URL) {
    const target = new URL(env.SITE_URL)
    url.protocol = target.protocol
    url.host = target.host
    // Setting `host` keeps the request's port when SITE_URL has none.
    url.port = target.port
  }
  return url
}
