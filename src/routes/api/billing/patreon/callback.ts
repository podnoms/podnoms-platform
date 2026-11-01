import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { getPatreonConfig } from '~/server/billing-config.server'
import { reportError } from '~/server/logger.server'
import { connectPatreon } from '~/server/patreon.server'
import { publicUrl } from '~/server/site-url.server'

// Where Patreon sends the user back to, after they've approved the connection.
export const Route = createFileRoute('/api/billing/patreon/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await getPatreonConfig())) return new Response('Not found', { status: 404 })
        const session = await getSession(request)
        const url = new URL(publicUrl(request))
        if (!session?.user?.id) return Response.redirect(`${url.origin}/?login=true`, 302)
        const back = new URL('/settings/billing', url.origin)
        try {
          const { error } = await connectPatreon({
            userId: session.user.id,
            state: url.searchParams.get('state'),
            code: url.searchParams.get('code'),
            origin: url.origin,
          })
          back.searchParams.set('patreon', error ?? 'connected')
        } catch (error) {
          reportError(error, { msg: 'Could not connect a Patreon account' })
          back.searchParams.set('patreon', 'failed')
        }
        return Response.redirect(back.toString(), 302)
      },
    },
  },
})
