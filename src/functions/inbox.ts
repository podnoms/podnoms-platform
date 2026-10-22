// Server functions for the notifications menu in the top bar (see
// inbox.server.ts).
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { getSession } from '~/server/auth.server'
import { countUnread, listNotifications, markNotificationsRead } from '~/server/inbox.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  if (!session?.user?.id) throw new Error('You need to be signed in')
  return session.user.id
}

export const fetchInbox = createServerFn({ method: 'GET' }).handler(async () => listNotifications(await requireUserId()))

// Polled, so the bell's count keeps up.
export const fetchUnreadCount = createServerFn({ method: 'GET' }).handler(async () => countUnread(await requireUserId()))

// These notifications, or (without ids) all of them.
export const markInboxRead = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: z.array(z.string().min(1)).max(100).optional() }))
  .handler(async ({ data }) => markNotificationsRead(await requireUserId(), data.ids))
