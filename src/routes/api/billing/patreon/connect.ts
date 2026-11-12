import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { getPatreonConfig } from '~/server/billing-config.server'
import { patreonAuthorizeUrl } from '~/server/patreon.server'
import { publicUrl } from '~/server/site-url.server'

// Starts connecting the signed-in user's Patreon account.
export const Route = createFileRoute('/api/billing/patreon/connect')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await getPatreonConfig())) return new Response('Not found', { status: 404 })
        const session = await getSession(request, { write: true })
        const { origin } = new URL(publicUrl(request))
        if (!session?.user?.id) return Response.redirect(`${origin}/?login=true`, 302)
        return Response.redirect(await patreonAuthorizeUrl(session.user.id, origin), 302)
      },
    },
  },
})
