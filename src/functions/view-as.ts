import { createServerFn } from '@tanstack/react-start'
import { deleteCookie, getRequest, setCookie } from '@tanstack/react-start/server'
import { z } from 'zod'
import { readSession } from '~/server/auth.server'
import { logger } from '~/server/logger.server'
import { publicUrl } from '~/server/site-url.server'
import { isAdmin } from '~/server/users.server'
import { userExists, viewAsCookieName, viewAsCookieValue, viewAsMaxAgeSeconds } from '~/server/view-as.server'

// Starts an admin viewing the site as another user, read-only (see
// view-as.server.ts). Goes by the admin's own session rather than getSession,
// so they can switch from viewing one user to another.
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
    setCookie(viewAsCookieName, viewAsCookieValue(adminId, data.userId), {
      httpOnly: true,
      sameSite: 'lax',
      secure: publicUrl(request).protocol === 'https:',
      path: '/',
      maxAge: viewAsMaxAgeSeconds,
    })
    logger.info({ adminId, userId: data.userId }, 'Admin started viewing the site as a user')
  })

// Anyone may drop the cookie: it only ever takes access away.
export const stopViewingAs = createServerFn({ method: 'POST' }).handler(() => {
  deleteCookie(viewAsCookieName, { path: '/' })
})
