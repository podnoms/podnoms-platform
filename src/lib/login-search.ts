import { z } from 'zod'

// Root-level search params that open the login dialog from any page:
// `login=true` opens it on sign-in, `login=signup` on account creation.
// `authError` carries the error code Auth.js reports after a failed sign-in,
// and `notice` a message to show.
export const loginSearchSchema = z.object({
  login: z.union([z.literal(true), z.literal('signup')]).optional().catch(undefined),
  authError: z.string().optional().catch(undefined),
  // A message for the dialog, e.g. `passwordReset` after choosing a new password.
  notice: z.literal('passwordReset').optional().catch(undefined),
})
export type LoginSearch = z.infer<typeof loginSearchSchema>
