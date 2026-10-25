import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { brandingSchema } from '~/lib/branding-schema'
import { getSession } from '~/server/auth.server'
import { getBranding, saveBranding } from '~/server/branding.server'
import { isAdmin } from '~/server/users.server'

// The site's branding (see src/lib/branding.ts), for the root route. Public.
export const fetchBranding = createServerFn({ method: 'GET' }).handler(() => getBranding())

export const saveSiteBranding = createServerFn({ method: 'POST' })
  .validator(brandingSchema)
  .handler(async ({ data }) => {
    const session = await getSession(getRequest())
    if (!session?.user?.id) throw new Error('You need to be signed in')
    if (!(await isAdmin(session.user.id))) throw new Error('Admins only')
    await saveBranding(data)
  })
