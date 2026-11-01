// Server functions for subscribing (see subscriptions.server.ts).
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { patreonSettingsSchema, stripeSettingsSchema } from '~/lib/billing-schema'
import { getSession } from '~/server/auth.server'
import { removePatreonSettings, removeStripeSettings, savePatreonSettings } from '~/server/billing-config.server'
import { disconnectPatreon } from '~/server/patreon.server'
import { publicUrl } from '~/server/site-url.server'
import { createCheckoutUrl, createPortalUrl, saveStripeSettings, stripePriceLabel } from '~/server/stripe.server'
import {
  getSubscriptionAdmin,
  getSubscriptionState,
  setPaidFeaturesEnforced,
  setPatreonMinimum,
} from '~/server/subscriptions.server'
import { isAdmin } from '~/server/users.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  const userId = session?.user?.id
  if (!userId) throw new Error('You need to be signed in')
  return userId
}

async function requireAdmin() {
  if (!(await isAdmin(await requireUserId()))) throw new Error('Not allowed')
}

const siteOrigin = () => new URL(publicUrl(getRequest())).origin

export const fetchMySubscription = createServerFn({ method: 'GET' }).handler(async () => ({
  ...(await getSubscriptionState(await requireUserId())),
  price: await stripePriceLabel(),
}))

export const startMyCheckout = createServerFn({ method: 'POST' }).handler(async () =>
  createCheckoutUrl(await requireUserId(), siteOrigin()),
)

export const openMyBillingPortal = createServerFn({ method: 'POST' }).handler(async () =>
  createPortalUrl(await requireUserId(), siteOrigin()),
)

export const disconnectMyPatreon = createServerFn({ method: 'POST' }).handler(async () => {
  await disconnectPatreon(await requireUserId())
})

export const fetchSubscriptionAdmin = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()
  return getSubscriptionAdmin(siteOrigin())
})

export const saveStripeDetails = createServerFn({ method: 'POST' })
  .validator(stripeSettingsSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    return saveStripeSettings(data)
  })

export const removeStripeDetails = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAdmin()
  return removeStripeSettings()
})

export const savePatreonDetails = createServerFn({ method: 'POST' })
  .validator(patreonSettingsSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    return savePatreonSettings(data)
  })

export const removePatreonDetails = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAdmin()
  return removePatreonSettings()
})

export const savePaidFeaturesEnforced = createServerFn({ method: 'POST' })
  .validator(z.object({ enforced: z.boolean() }))
  .handler(async ({ data }) => {
    await requireAdmin()
    await setPaidFeaturesEnforced(data.enforced)
  })

export const savePatreonMinimum = createServerFn({ method: 'POST' })
  .validator(z.object({ cents: z.number().int().min(0).max(1_000_000) }))
  .handler(async ({ data }) => {
    await requireAdmin()
    await setPatreonMinimum(data.cents)
  })
