import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

// Auth.js sends failed sign-ins here (pages.signIn in auth.server.ts). Sign-in
// itself happens in the login dialog, so reopen it with the error shown.
export const Route = createFileRoute('/login')({
  validateSearch: z.object({ error: z.string().optional() }),
  beforeLoad: ({ context, search }) => {
    throw redirect({
      to: '/',
      search: context.session ? {} : { login: true, authError: search.error },
    })
  },
})
