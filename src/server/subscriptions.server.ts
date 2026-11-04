// Who gets paid features: live broadcasts, custom domains, channels and
// playlists, private shows, tracked links and show themes
// (src/lib/subscriptions.ts).
//
// Everything is free until an admin turns paid features on, which needs Stripe
// or Patreon set up, so a site with neither is unaffected. From then on a user
// has them while they're an admin, have been given them by an admin, have an
// active subscription from either provider, or are in their grace period: 14
// days from paid features being turned on, or from their last active
// subscription or complimentary access ending. After that what they've set up
// stops working but is kept, so subscribing brings it all back.
// A private show always stays private: only its feed key stops working.
//
// Without paid features, an account can have at most 10 hours of audio across
// its shows (requireAudioRoom), counting everything but failed episodes. Audio
// it already has stays: over the limit, it just can't add more. A link's length
// isn't known when it's added, so the processor checks again as it goes.
import '@tanstack/react-start/server-only'
import { and, count, eq, exists, ne, sql } from 'drizzle-orm'
import { freeAudioHours, paidFeatures, paidGraceDays, paidPlanName, type PaidFeature } from '~/lib/subscriptions'
import { billingConfigured, getBillingDetails, getPatreonConfig, getStripeConfig } from '~/server/billing-config.server'
import { getBranding } from '~/server/branding.server'
import { db } from '~/server/db/client.server'
import { episodes, shows, subscriptions, users } from '~/server/db/schema'
import { emailEnabled, emailOrigin, sendEmail } from '~/server/email.server'
import { subscriptionLapsedEmail } from '~/server/emails.server'
import { recordNotification } from '~/server/inbox.server'
import { logger, reportError } from '~/server/logger.server'
import { getSiteSettings, updateSiteSettings } from '~/server/site-settings.server'

const billingPath = '/settings/billing'

export class PaidFeatureError extends Error {
  override name = 'PaidFeatureError'

  constructor(feature: PaidFeature) {
    super(`${paidFeatures[feature].title} need a ${paidPlanName} subscription`)
  }
}

export async function paidFeaturesEnforced() {
  if (!(await billingConfigured())) return false
  return (await getSiteSettings()).paidFeaturesStartedAt !== null
}

const hasActiveSubscription = (userId: string) =>
  db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.active, true)))
    .limit(1)
    .then((rows) => rows.length > 0)

export async function hasPaidAccess(userId: string) {
  if (!(await paidFeaturesEnforced())) return true
  const [user] = await db
    .select({
      isAdmin: users.isAdmin,
      complimentary: users.complimentaryAccess,
      graceUntil: users.paidGraceUntil,
      subscribed: exists(
        db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(and(eq(subscriptions.userId, users.id), eq(subscriptions.active, true))),
      ),
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user) return false
  return user.isAdmin || user.complimentary || Boolean(user.subscribed) || (user.graceUntil !== null && user.graceUntil > new Date())
}

export async function requirePaidAccess(userId: string, feature: PaidFeature) {
  if (!(await hasPaidAccess(userId))) throw new PaidFeatureError(feature)
}

export const freeAudioSeconds = freeAudioHours * 60 * 60

export class AudioLimitError extends Error {
  override name = 'AudioLimitError'

  constructor() {
    super(
      `That would take you past your ${freeAudioHours} free hours of audio. Delete some episodes, or subscribe to ${paidPlanName} for unlimited hours.`,
    )
  }
}

// The length of all the user's audio, apart from one episode if given.
export async function audioSecondsUsed(userId: string, { except }: { except?: string } = {}) {
  const [row] = await db
    .select({ total: sql`coalesce(sum(${episodes.durationSeconds}), 0)`.mapWith(Number) })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(and(eq(shows.userId, userId), ne(episodes.status, 'failed'), except ? ne(episodes.id, except) : undefined))
  return row!.total
}

// Throws unless the user can add this much audio. Pass 0 when the length isn't
// known yet, which only checks they aren't already at the limit.
export async function requireAudioRoom(userId: string, adding: number, options: { except?: string } = {}) {
  if (await hasPaidAccess(userId)) return
  const used = await audioSecondsUsed(userId, options)
  if (used >= freeAudioSeconds || used + adding > freeAudioSeconds) throw new AudioLimitError()
}

// Runs something that may hit the limit, returning the refusal for the form to
// show rather than throwing it.
export async function catchAudioLimit<T>(run: () => Promise<T>): Promise<{ value: T } | { error: string }> {
  try {
    return { value: await run() }
  } catch (error) {
    if (error instanceof AudioLimitError) return { error: error.message }
    throw error
  }
}

// Starts or extends a grace period; it never shortens one.
const graceFrom = (now: Date) => {
  const until = new Date(now.getTime() + paidGraceDays * 24 * 60 * 60_000)
  return sql`greatest(${users.paidGraceUntil}, ${until.toISOString()}::timestamptz)`
}

// Turns paid features on or off for the whole site. Turning them on gives
// everyone there now their grace period.
export async function setPaidFeaturesEnforced(enforced: boolean, now = new Date()) {
  if (enforced && !(await billingConfigured())) throw new Error('Set up Stripe or Patreon first')
  if (enforced) await db.update(users).set({ paidGraceUntil: graceFrom(now) })
  await updateSiteSettings({ paidFeaturesStartedAt: enforced ? now.toISOString() : null })
  logger.info({ enforced }, 'Paid features changed')
}

export type SubscriptionUpdate = {
  userId: string
  provider: 'stripe' | 'patreon'
  externalId: string
  status: string
  active: boolean
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

// Saves what a provider says about a subscription. Providers repeat themselves
// and send things out of order, so what happens next depends only on whether
// the user went from having an active subscription to having none.
export async function recordSubscription(update: SubscriptionUpdate, now = new Date()) {
  const before = await hasActiveSubscription(update.userId)
  const { provider, externalId, ...values } = update
  await db
    .insert(subscriptions)
    .values({ ...values, provider, externalId, updatedAt: now })
    .onConflictDoUpdate({
      target: [subscriptions.provider, subscriptions.externalId],
      set: { ...values, updatedAt: now },
    })
  if (before && !(await hasActiveSubscription(update.userId))) await startGrace(update.userId, now)
}

// The user's last active subscription has ended. Admins and users with
// complimentary access keep their paid features, so aren't told they'll stop.
export async function startGrace(userId: string, now = new Date()) {
  const [user] = await db
    .update(users)
    .set({ paidGraceUntil: graceFrom(now) })
    .where(eq(users.id, userId))
    .returning({ isAdmin: users.isAdmin, complimentary: users.complimentaryAccess })
  logger.info({ userId }, 'Subscription ended; grace period started')
  if (user && !user.isAdmin && !user.complimentary && (await paidFeaturesEnforced())) await tellUserOfLapse(userId)
}

// Gives the user paid features for free, or takes them back, which starts their
// grace period unless they're also paying. Resolves to whether the user exists.
export async function setComplimentaryAccess(userId: string, complimentary: boolean, now = new Date()) {
  const [user] = await db
    .select({ complimentary: users.complimentaryAccess })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user) return false
  if (user.complimentary === complimentary) return true
  await db.update(users).set({ complimentaryAccess: complimentary }).where(eq(users.id, userId))
  logger.info({ userId, complimentary }, 'Complimentary access changed')
  if (!complimentary && !(await hasActiveSubscription(userId))) await startGrace(userId, now)
  return true
}

async function tellUserOfLapse(userId: string) {
  try {
    await recordNotification([userId], {
      kind: 'subscriptionLapsed',
      title: `Your ${paidPlanName} subscription has ended`,
      body: `Your paid features and unlimited audio will stop in ${paidGraceDays} days unless you subscribe again.`,
      url: billingPath,
    })
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
    if (!user?.email || !(await emailEnabled())) return
    const origin = emailOrigin()
    const { name } = await getBranding()
    const link = origin ? new URL(billingPath, origin).toString() : null
    await sendEmail({ to: user.email, ...subscriptionLapsedEmail(paidPlanName, paidGraceDays, freeAudioHours, link, name) })
  } catch (error) {
    // The subscription's end is already saved; don't have the provider resend it.
    reportError(error, { msg: 'Could not tell a user their subscription ended', userId })
  }
}

export async function getSubscriptionState(userId: string) {
  const [user] = await db
    .select({
      isAdmin: users.isAdmin,
      complimentary: users.complimentaryAccess,
      graceUntil: users.paidGraceUntil,
      stripeCustomerId: users.stripeCustomerId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const rows = await db
    .select({
      provider: subscriptions.provider,
      status: subscriptions.status,
      active: subscriptions.active,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
  const graceUntil = user?.graceUntil && user.graceUntil > new Date() ? user.graceUntil : null
  const [stripe, patreon] = await Promise.all([getStripeConfig(), getPatreonConfig()])
  return {
    enforced: await paidFeaturesEnforced(),
    hasAccess: await hasPaidAccess(userId),
    isAdmin: user?.isAdmin ?? false,
    complimentary: user?.complimentary ?? false,
    graceUntil,
    canManageStripe: Boolean(user?.stripeCustomerId) && stripe !== null,
    stripe: rows.find((row) => row.provider === 'stripe' && row.active) ?? null,
    patreon: rows.find((row) => row.provider === 'patreon') ?? null,
    stripeAvailable: stripe !== null,
    patreonAvailable: patreon !== null,
    patreonUrl: patreon?.url ?? null,
    audioUsedSeconds: await audioSecondsUsed(userId),
    freeAudioSeconds,
  }
}

// For the admin page.
export async function getSubscriptionAdmin(origin: string) {
  const settings = await getSiteSettings()
  const counts = await db
    .select({ provider: subscriptions.provider, total: count() })
    .from(subscriptions)
    .where(eq(subscriptions.active, true))
    .groupBy(subscriptions.provider)
  const active = (provider: string) => counts.find((row) => row.provider === provider)?.total ?? 0
  return {
    ...(await getBillingDetails()),
    addresses: {
      stripeWebhook: `${origin}/api/billing/stripe/webhook`,
      patreonWebhook: `${origin}/api/billing/patreon/webhook`,
      patreonRedirect: `${origin}/api/billing/patreon/callback`,
    },
    startedAt: settings.paidFeaturesStartedAt,
    patreonMinimumCents: settings.patreonMinimumCents,
    activeStripe: active('stripe'),
    activePatreon: active('patreon'),
  }
}

export async function setPatreonMinimum(cents: number) {
  await updateSiteSettings({ patreonMinimumCents: cents })
}
