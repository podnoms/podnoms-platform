import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { setPasswordSchema } from '~/lib/auth-schema'
import { editProfileSchema } from '~/lib/profile-schema'
import { getSession } from '~/server/auth.server'
import { getProfile, hasPassword, setPassword, updateProfile } from '~/server/users.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  if (!session?.user?.id) throw new Error('You need to be signed in')
  return session.user.id
}

export const fetchProfile = createServerFn({ method: 'GET' }).handler(async () => {
  const profile = await getProfile(await requireUserId())
  if (!profile) throw new Error('You need to be signed in')
  return profile
})

export const saveProfile = createServerFn({ method: 'POST' })
  .validator(editProfileSchema)
  .handler(async ({ data }) => {
    if (!(await updateProfile(await requireUserId(), data))) throw new Error('You need to be signed in')
  })

export const fetchHasPassword = createServerFn({ method: 'GET' }).handler(async () =>
  hasPassword(await requireUserId()),
)

export const savePassword = createServerFn({ method: 'POST' })
  .validator(setPasswordSchema)
  .handler(async ({ data }) => setPassword(await requireUserId(), data.password, data.currentPassword))
