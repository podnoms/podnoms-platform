// The browser extension's API (src/routes/api/extension/*), which sends
// requests with the user's own session cookie: the extension has permission
// to this site, so the browser includes it.
import '@tanstack/react-start/server-only'
import { getSession } from '~/server/auth.server'
import { publicUrl } from '~/server/site-url.server'

// The signed-in user's id, or the response to send instead. Writes must be
// JSON: other sites can't send that with the cookie without a CORS preflight,
// which this API never allows, so they can't add episodes on a user's behalf.
export async function extensionUserId(request: Request): Promise<string | Response> {
  if (request.method !== 'GET' && !request.headers.get('content-type')?.startsWith('application/json')) {
    return new Response('Send JSON', { status: 415 })
  }
  const session = await getSession(request)
  return session?.user?.id ?? new Response('You need to be signed in', { status: 401 })
}

// A path on this site (a stored image, a page) as a full URL, since the
// extension isn't on this site.
export function siteUrl(request: Request, path: string) {
  return new URL(path, publicUrl(request)).href
}
