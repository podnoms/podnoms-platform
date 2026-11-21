import { createFileRoute } from '@tanstack/react-router'
import { isCloudProvider, type CloudConnectedMessage } from '~/lib/cloud-storage'
import { getSession } from '~/server/auth.server'
import { cloudProviderEnabled, connectCloud } from '~/server/cloud-storage.server'
import { reportError } from '~/server/logger.server'
import { publicUrl } from '~/server/site-url.server'

// Where Dropbox or Box sends the sign-in popup back to. It tells the page that
// opened it how it went, and closes.
export const Route = createFileRoute('/api/cloud/$provider/callback')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { provider } = params
        if (!isCloudProvider(provider) || !cloudProviderEnabled(provider)) return new Response('Not found', { status: 404 })
        const session = await getSession(request, { write: true })
        const url = new URL(publicUrl(request))
        let ok = false
        if (session?.user?.id) {
          try {
            ok = await connectCloud({
              userId: session.user.id,
              provider,
              state: url.searchParams.get('state'),
              code: url.searchParams.get('code'),
              origin: url.origin,
            })
          } catch (error) {
            reportError(error, { msg: 'Could not sign in to cloud storage', provider })
          }
        }
        const message: CloudConnectedMessage = { type: 'cloud-storage-connected', provider, ok }
        // Only the site's own pages get the message. The values are ours, so
        // they're safe in the script; < is escaped anyway.
        const script = `window.opener&&window.opener.postMessage(${JSON.stringify(message)},${JSON.stringify(url.origin)});window.close()`
        const html = `<!doctype html><meta charset="utf-8"><title>Signed in</title><p>${ok ? 'Signed in. You can close this window.' : "That didn't work. Close this window and try again."}</p><script>${script.replace(/</g, '\\u003c')}</script>`
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
      },
    },
  },
})
