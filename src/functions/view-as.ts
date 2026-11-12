import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { readSession } from '~/server/auth.server'
import { logger } from '~/server/logger.server'
import { isAdmin } from '~/server/users.server'
import { createViewAsToken, userExists } from '~/server/view-as.server'

// A token for an admin's tab to view the site as another user with,
// read-only (see view-as.server.ts). Goes by the admin's own session rather
// than getSession, so a tab can switch from viewing one user to another.
export const startViewingAs = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    const request = getRequest()
    const session = await readSession(request)
    const adminId = session && !session.twoFactorPending ? session.user?.id : undefined
    if (!adminId) throw new Error('You need to be signed in')
    if (!(await isAdmin(adminId))) throw new Error('Admins only')
    if (data.userId === adminId) throw new Error("That's you")
    if (!(await userExists(data.userId))) throw new Error('No such user')
    logger.info({ adminId, userId: data.userId }, 'Admin started viewing the site as a user')
    return createViewAsToken(adminId, data.userId)
  })
