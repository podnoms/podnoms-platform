import { createFileRoute } from '@tanstack/react-router'
import { isCloudProvider } from '~/lib/cloud-storage'
import { getSession } from '~/server/auth.server'
import { cloudAuthorizeUrl, cloudProviderEnabled } from '~/server/cloud-storage.server'
import { publicUrl } from '~/server/site-url.server'

// Starts signing the user in to Dropbox or Box, in the popup the bulk upload
// dialog opens (see cloud-storage.server.ts).
export const Route = createFileRoute('/api/cloud/$provider/connect')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isCloudProvider(params.provider) || !cloudProviderEnabled(params.provider)) {
          return new Response('Not found', { status: 404 })
        }
        const session = await getSession(request, { write: true })
        const { origin } = new URL(publicUrl(request))
        if (!session?.user?.id) return Response.redirect(`${origin}/?login=true`, 302)
        return Response.redirect(cloudAuthorizeUrl(session.user.id, params.provider, origin), 302)
      },
    },
  },
})
