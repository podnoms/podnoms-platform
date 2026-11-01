// Stripe subscriptions: Checkout to subscribe, the billing portal to change or
// cancel, and a webhook to hear what happened. Each event only says which
// subscription to look at, and the subscription is then fetched, so events
// arriving late, repeated or out of order do no harm.
import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { env } from '~/env'
import type { StripeSettingsInput } from '~/lib/billing-schema'
import { getStripeConfig, savedStripeDetails, storeStripeDetails } from '~/server/billing-config.server'
import { db } from '~/server/db/client.server'
import { users } from '~/server/db/schema'
import { ExpiringStore } from '~/server/expiring-store.server'
import { logger } from '~/server/logger.server'
import { recordSubscription } from '~/server/subscriptions.server'

// Past-due subscriptions keep access while Stripe retries the payment. It then
// moves them to canceled or unpaid, as set in the Stripe dashboard.
const activeStatuses: Stripe.Subscription.Status[] = ['active', 'trialing', 'past_due']

let testClient: Stripe | null = null
let client: { secretKey: string; stripe: Stripe } | null = null

// One client per key, rebuilt when an admin changes it.
function clientFor(secretKey: string) {
  if (testClient) return testClient
  if (client?.secretKey !== secretKey) client = { secretKey, stripe: new Stripe(secretKey) }
  return client.stripe
}

async function configured() {
  const config = await getStripeConfig()
  if (!config) throw new Error('Stripe is not set up')
  return { config, stripe: clientFor(config.secretKey) }
}

// For tests, which stand in for Stripe's API.
export function setStripeClient(next: Stripe | null) {
  testClient = next
}

async function customerFor(stripe: Stripe, userId: string, { fresh = false } = {}) {
  const [user] = await db
    .select({ email: users.email, customerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user) throw new Error('User not found')
  if (user.customerId && !fresh) return user.customerId
  const customer = await stripe.customers.create({ email: user.email ?? undefined, metadata: { userId } })
  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, userId))
  return customer.id
}

// Runs something with the user's Stripe customer. A customer made under other
// keys (test ones, before going live) isn't known to these, so they get a new one.
async function withCustomer<T>(stripe: Stripe, userId: string, run: (customer: string) => Promise<T>) {
  try {
    return await run(await customerFor(stripe, userId))
  } catch (error) {
    const { code, param } = error as { code?: string; param?: string }
    if (code !== 'resource_missing' || param !== 'customer') throw error
    return run(await customerFor(stripe, userId, { fresh: true }))
  }
}

// Where to send the user to subscribe.
export async function createCheckoutUrl(userId: string, origin: string) {
  const { stripe, config } = await configured()
  const session = await withCustomer(stripe, userId, (customer) =>
    stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: userId,
      line_items: [{ price: config.priceId, quantity: 1 }],
      subscription_data: { metadata: { userId } },
      allow_promotion_codes: true,
      success_url: `${origin}/settings/billing?checkout=done`,
      cancel_url: `${origin}/settings/billing`,
    }),
  )
  if (!session.url) throw new Error('Stripe gave no checkout address')
  return session.url
}

// Where to send the user to change or cancel their subscription.
export async function createPortalUrl(userId: string, origin: string) {
  const { stripe } = await configured()
  const session = await withCustomer(stripe, userId, (customer) =>
    stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/settings/billing` }),
  )
  return session.url
}

const priceLabels = new ExpiringStore<{ label: string | null }>(60 * 60_000)

// The price as people should see it, e.g. "€5.00 a month"; null if Stripe can't say.
export async function stripePriceLabel() {
  const config = await getStripeConfig()
  if (!config) return null
  const cacheKey = `${config.secretKey}:${config.priceId}`
  const cached = priceLabels.get(cacheKey)
  if (cached) return cached.label
  let label: string | null = null
  try {
    const price = await clientFor(config.secretKey).prices.retrieve(config.priceId)
    if (price.unit_amount !== null) {
      const amount = new Intl.NumberFormat('en-IE', { style: 'currency', currency: price.currency }).format(price.unit_amount / 100)
      label = price.recurring ? `${amount} a ${price.recurring.interval}` : amount
    }
  } catch (error) {
    logger.warn({ error }, 'Could not read the Stripe price')
  }
  priceLabels.set(cacheKey, { label })
  return label
}

// Saves the details entered on the admin page, once Stripe has confirmed the
// key works and the price is one people can subscribe to. Returns why not, if so.
export async function saveStripeSettings(input: StripeSettingsInput): Promise<{ error: string | null }> {
  if (env.STRIPE_SECRET_KEY) return { error: 'Stripe is set by environment variables, so it can’t be changed here' }
  const saved = await savedStripeDetails()
  const secretKey = input.secretKey || saved.secretKey
  const webhookSecret = input.webhookSecret || saved.webhookSecret
  if (!secretKey) return { error: 'Enter the secret key' }
  if (!webhookSecret) return { error: 'Enter the webhook signing secret' }
  try {
    const price = await clientFor(secretKey).prices.retrieve(input.priceId)
    if (!price.recurring) return { error: 'That price is one-off; use a recurring one' }
  } catch (error) {
    const { type, code } = error as { type?: string; code?: string }
    if (type === 'StripeAuthenticationError') return { error: 'Stripe refused that secret key' }
    if (code === 'resource_missing') return { error: 'Stripe has no such price for that key' }
    logger.warn({ type, code }, 'Could not check the Stripe details')
    return { error: "Couldn't check that with Stripe. Please try again." }
  }
  await storeStripeDetails({ secretKey, webhookSecret, priceId: input.priceId })
  return { error: null }
}

async function syncSubscription(stripe: Stripe, subscriptionId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
  // Going by our own customer, so a subscription in the same Stripe account for
  // something else is ignored.
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.stripeCustomerId, customerId)).limit(1)
  if (!user) {
    logger.info({ subscriptionId }, 'Ignoring a Stripe subscription for an unknown customer')
    return
  }
  const periodEnd = subscription.items.data[0]?.current_period_end
  await recordSubscription({
    userId: user.id,
    provider: 'stripe',
    externalId: subscription.id,
    status: subscription.status,
    active: activeStatuses.includes(subscription.status),
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  })
}

export class InvalidWebhookError extends Error {}

// Checks a webhook's signature and acts on it. Anything thrown after the check
// makes the route answer 500, so Stripe tries again.
export async function handleStripeWebhook(body: string, signature: string | null) {
  const { stripe, config } = await configured()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature ?? '', config.webhookSecret)
  } catch (error) {
    throw new InvalidWebhookError(error instanceof Error ? error.message : 'Invalid signature')
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      const { subscription } = event.data.object
      if (subscription) await syncSubscription(stripe, typeof subscription === 'string' ? subscription : subscription.id)
      break
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      await syncSubscription(stripe, event.data.object.id)
      break
  }
}
