import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getRequest } from '@tanstack/react-start/server'
import { credentialsSchema, passwordResetRequestSchema, resetPasswordSchema } from '~/lib/auth-schema'
import { oauthProviders, readSession } from '~/server/auth.server'
import { publicUrl } from '~/server/site-url.server'
import { clientIp } from '~/server/activity.server'
import { emailEnabled } from '~/server/email.server'
import { isResetTokenValid, requestPasswordReset, resetPassword } from '~/server/password-reset.server'
import { getTwoFactorMethods } from '~/server/two-factor.server'
import { createUser, getProfile } from '~/server/users.server'

// The signed-in user, or, for a user who still has to pass two-factor
// authentication, the second factors they can use.
export const fetchAuthState = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await readSession(getRequest())
  if (session?.twoFactorPending && session.user?.id) {
    return { session: null, twoFactor: await getTwoFactorMethods(session.user.id) }
  }
  // From the database, so changes on the settings page show straight away.
  const profile = session?.user?.id ? await getProfile(session.user.id) : null
  return {
    session: profile
      ? { user: { name: profile.name, email: profile.email, image: profile.imageUrl, isAdmin: profile.isAdmin } }
      : null,
    twoFactor: null,
  }
})

// Which OAuth providers have keys configured, so the login page can disable the
// rest, and whether email works, for "Forgot password?".
export const fetchOAuthProviders = createServerFn({ method: 'GET' }).handler(async () => ({
  ...oauthProviders,
  passwordReset: await emailEnabled(),
}))

export const requestPasswordResetFn = createServerFn({ method: 'POST' })
  .validator(passwordResetRequestSchema)
  .handler(async ({ data }) => {
    const request = getRequest()
    await requestPasswordReset(data.email, publicUrl(request).origin, clientIp(request))
  })

export const checkResetToken = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string().max(200) }))
  .handler(({ data }) => isResetTokenValid(data.token))

export const resetPasswordFn = createServerFn({ method: 'POST' })
  .validator(resetPasswordSchema)
  .handler(({ data }) => resetPassword(data.token, data.password))

export const signUp = createServerFn({ method: 'POST' })
  .validator(credentialsSchema)
  .handler(async ({ data }) => {
    const user = await createUser(data.email, data.password)
    return user
      ? { ok: true as const }
      : {
          ok: false as const,
          error:
            'An account with that email already exists. Sign in instead, or if you signed up with GitHub, Google or Facebook, sign in that way and add a password in Settings → Security.',
        }
  })
