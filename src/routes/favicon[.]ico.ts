import { createFileRoute } from '@tanstack/react-router'
import { brandIconResponse } from '~/server/branding.server'

// Where browsers look for an icon when a page doesn't say. A PNG, which every
// current browser accepts here.
export const Route = createFileRoute('/favicon.ico')({
  server: { handlers: { GET: ({ request }) => brandIconResponse(request, 32) } },
})
