import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { credentialsSchema } from '~/lib/auth-schema'
import { getSession, oauthProviders } from '~/server/auth.server'
import { createUser } from '~/server/users.server'

export const fetchSession = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession(getRequest())
  return session?.user ? { user: { name: session.user.name ?? null, email: session.user.email ?? null } } : null
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
