import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { emailSettingsSchema, siteSettingsSchema, testEmailSchema, userChannelLimitSchema } from '~/lib/site-settings-schema'
import {
  endCooldown,
  getAdminOverview,
  saveEmailSettings,
  saveSiteSettings,
  sendTestEmail,
  setUserChannelLimit,
} from '~/server/admin.server'
import { getSession } from '~/server/auth.server'
import { isAdmin } from '~/server/users.server'

async function requireAdmin() {
  const session = await getSession(getRequest())
  if (!session?.user?.id) throw new Error('You need to be signed in')
  if (!(await isAdmin(session.user.id))) throw new Error('Admins only')
  return session.user.id
}

export const fetchAdminOverview = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()
  return getAdminOverview()
})

export const saveAdminSettings = createServerFn({ method: 'POST' })
  .validator(siteSettingsSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    await saveSiteSettings(data)
  })

export const saveAdminEmailSettings = createServerFn({ method: 'POST' })
  .validator(emailSettingsSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    if (!(await saveEmailSettings(data))) throw new Error('Email is set by environment variables on this site')
  })

export const sendAdminTestEmail = createServerFn({ method: 'POST' })
  .validator(testEmailSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    return sendTestEmail(data.to, data.settings)
  })

export const saveUserChannelLimit = createServerFn({ method: 'POST' })
  .validator(userChannelLimitSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    if (!(await setUserChannelLimit(data.userId, data.limit))) throw notFound()
  })

export const endPlatformCooldown = createServerFn({ method: 'POST' })
  .validator(z.object({ platform: z.enum(['youtube', 'mixcloud', 'soundcloud', 'other']) }))
  .handler(async ({ data }) => {
    await requireAdmin()
    endCooldown(data.platform)
  })
