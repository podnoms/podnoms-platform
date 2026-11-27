import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { setPasswordSchema } from '~/lib/auth-schema'
import { editProfileSchema, followNotifySchema, notificationPrefsSchema } from '~/lib/profile-schema'
import { getSession } from '~/server/auth.server'
import { emailEnabled } from '~/server/email.server'
import { listFollowNotify, setFollowNotify } from '~/server/follower-notifications.server'
import {
  getNotificationPrefs,
  getProfile,
  hasPassword,
  setPassword,
  updateNotificationPrefs,
  updateProfile,
} from '~/server/users.server'
import { getKeepListeningHistory, listeningHistoryKeepDays, setKeepListeningHistory } from '~/server/listening-history.server'

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

// Returns whether the slug was taken (in which case nothing was saved).
export const saveProfile = createServerFn({ method: 'POST' })
  .validator(editProfileSchema)
  .handler(async ({ data }) => {
    const result = await updateProfile(await requireUserId(), data)
    if (!result) throw new Error('You need to be signed in')
    return { slugTaken: result === 'slug-taken' }
  })

export const fetchHasPassword = createServerFn({ method: 'GET' }).handler(async () =>
  hasPassword(await requireUserId()),
)

export const savePassword = createServerFn({ method: 'POST' })
  .validator(setPasswordSchema)
  .handler(async ({ data }) => setPassword(await requireUserId(), data.password, data.currentPassword))

// The user's notification choices, the shows they follow (each of which
// they can mute), and whether the site can send email at all.
export const fetchNotificationPrefs = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUserId()
  const prefs = await getNotificationPrefs(userId)
  if (!prefs) throw new Error('You need to be signed in')
  return { ...prefs, follows: await listFollowNotify(userId), emailEnabled: await emailEnabled() }
})

export const saveNotificationPrefs = createServerFn({ method: 'POST' })
  .validator(notificationPrefsSchema)
  .handler(async ({ data }) => updateNotificationPrefs(await requireUserId(), data))

export const saveFollowNotify = createServerFn({ method: 'POST' })
  .validator(followNotifySchema)
  .handler(async ({ data }) => {
    if (!(await setFollowNotify(await requireUserId(), data.showId, data.notify))) throw new Error("You don't follow that show")
  })

// Whether what they play, download and share is kept against their account
// (see listening-history.server.ts).
export const fetchListeningHistoryPref = createServerFn({ method: 'GET' }).handler(async () => {
  const keep = await getKeepListeningHistory(await requireUserId())
  if (keep === null) throw new Error('You need to be signed in')
  return { keep, keepDays: listeningHistoryKeepDays }
})

// Turning it off deletes what's been kept.
export const saveListeningHistoryPref = createServerFn({ method: 'POST' })
  .validator(z.object({ keep: z.boolean() }))
  .handler(async ({ data }) => setKeepListeningHistory(await requireUserId(), data.keep))
