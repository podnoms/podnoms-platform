import { createFileRoute, redirect } from '@tanstack/react-router'

// The security page moved into settings.
export const Route = createFileRoute('/_authed/security')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/security' })
  },
})
