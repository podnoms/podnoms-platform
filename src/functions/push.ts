// Server functions for desktop notifications (see push.server.ts): turning
// them on and off in a browser, and choosing what they're about.
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { pushPrefsSchema, pushSubscriptionSchema, removePushSubscriptionSchema } from '~/lib/push-schema'
import { getSession } from '~/server/auth.server'
import { deletePushSubscription, getPushSettings, savePushSubscription, updatePushPrefs } from '~/server/push.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  if (!session?.user?.id) throw new Error('You need to be signed in')
  return session.user.id
}

export const fetchPushSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const settings = await getPushSettings(await requireUserId())
  if (!settings) throw new Error('You need to be signed in')
  return settings
})

export const subscribeToPush = createServerFn({ method: 'POST' })
  .validator(pushSubscriptionSchema)
  .handler(async ({ data }) =>
    savePushSubscription(await requireUserId(), data, getRequest().headers.get('user-agent')),
  )

export const unsubscribeFromPush = createServerFn({ method: 'POST' })
  .validator(removePushSubscriptionSchema)
  .handler(async ({ data }) => deletePushSubscription(await requireUserId(), data))

export const savePushPrefs = createServerFn({ method: 'POST' })
  .validator(pushPrefsSchema)
  .handler(async ({ data }) => updatePushPrefs(await requireUserId(), data))
