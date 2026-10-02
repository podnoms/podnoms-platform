import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { credentialsSchema } from '~/lib/auth-schema'
import { oauthProviders, readSession } from '~/server/auth.server'
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
    session: profile ? { user: { name: profile.name, email: profile.email, image: profile.imageUrl } } : null,
    twoFactor: null,
  }
})

// Which OAuth providers have keys configured, so the login page can disable the rest.
export const fetchOAuthProviders = createServerFn({ method: 'GET' }).handler(() => oauthProviders)

export const signUp = createServerFn({ method: 'POST' })
  .validator(credentialsSchema)
  .handler(async ({ data }) => {
    const user = await createUser(data.email, data.password)
    return user
      ? { ok: true as const }
      : { ok: false as const, error: 'An account with that email already exists' }
  })
