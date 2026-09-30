import { createFileRoute, redirect } from '@tanstack/react-router'

// Layout route for pages that need a signed-in user. It adds nothing to the
// URL: src/routes/_authed/items.tsx is served at /items. Signed-out visitors
// are sent to the landing page with the login dialog open.
export const Route = createFileRoute('/_authed')({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: '/', search: { login: true } })
  },
})
