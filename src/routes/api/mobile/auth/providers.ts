import { createFileRoute } from '@tanstack/react-router'
import { oauthProviders } from '~/server/auth.server'

// Which OAuth providers the sign-in screen can offer: those this site has set up.
export const Route = createFileRoute('/api/mobile/auth/providers')({
  server: {
    handlers: {
      GET: () => Response.json(oauthProviders),
    },
  },
})
