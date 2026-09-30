import { createFileRoute } from '@tanstack/react-router'
import { handleAuthRequest } from '~/server/auth.server'

// Auth.js endpoints: sign-in, OAuth callbacks, session, csrf and sign-out.
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})
