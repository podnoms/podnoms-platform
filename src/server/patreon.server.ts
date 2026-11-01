// Patreon pledges. A user connects their Patreon account once, through OAuth,
// which tells us their Patreon id and their pledge to our campaign; webhooks
// then keep that up to date. Tokens aren't kept: they're only used to read the
// pledge while connecting, and connecting again reads it afresh.
import '@tanstack/react-start/server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getPatreonConfig, type PatreonConfig } from '~/server/billing-config.server'
import { db } from '~/server/db/client.server'
import { subscriptions } from '~/server/db/schema'
import { ExpiringStore } from '~/server/expiring-store.server'
import { logger } from '~/server/logger.server'
import { getSiteSettings } from '~/server/site-settings.server'
import { recordSubscription, startGrace } from '~/server/subscriptions.server'

const patreonOrigin = 'https://www.patreon.com'

const memberSchema = z.object({
  id: z.string(),
  type: z.literal('member'),
  attributes: z
    .object({
      patron_status: z.string().nullish(),
      currently_entitled_amount_cents: z.number().nullish(),
      next_charge_date: z.string().nullish(),
    })
    .default({}),
  relationships: z
    .object({
      campaign: z.object({ data: z.object({ id: z.string() }).nullish() }).optional(),
      user: z.object({ data: z.object({ id: z.string() }).nullish() }).optional(),
    })
    .optional(),
})
type Member = z.infer<typeof memberSchema>

const isOurCampaign = (member: Member, config: PatreonConfig) => member.relationships?.campaign?.data?.id === config.campaignId

// What a member of our campaign amounts to, as a subscription.
async function subscriptionFrom(member: Member | null) {
  const { patreonMinimumCents } = await getSiteSettings()
  const status = member?.attributes.patron_status ?? 'none'
  const cents = member?.attributes.currently_entitled_amount_cents ?? 0
  const charge = member?.attributes.next_charge_date
  return {
    status,
    active: status === 'active_patron' && cents >= patreonMinimumCents,
    currentPeriodEnd: charge ? new Date(charge) : null,
    cancelAtPeriodEnd: false,
  }
}

// --- Connecting ----------------------------------------------------------------

const redirectUri = (origin: string) => `${origin}/api/billing/patreon/callback`

// Which user each connection in progress is for, by its OAuth state.
const pendingConnections = new ExpiringStore<string>(10 * 60_000)

// Where to send the user to approve the connection.
export async function patreonAuthorizeUrl(userId: string, origin: string) {
  const config = await getPatreonConfig()
  if (!config) throw new Error('Patreon is not set up')
  const state = randomBytes(24).toString('base64url')
  pendingConnections.set(state, userId)
  const url = new URL('/oauth2/authorize', patreonOrigin)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri(origin),
    // Only ever shows us their membership of our own campaign.
    scope: 'identity',
    state,
  }).toString()
  return url.toString()
}

export class PatreonConnectError extends Error {}

const identitySchema = z.object({
  data: z.object({ id: z.string() }),
  included: z.array(z.unknown()).default([]),
})

async function fetchIdentity(code: string, origin: string, config: PatreonConfig) {
  const tokenResponse = await fetch(new URL('/api/oauth2/token', patreonOrigin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri(origin),
    }),
  })
  if (!tokenResponse.ok) throw new PatreonConnectError(`Patreon refused the code (${tokenResponse.status})`)
  const { access_token: token } = z.object({ access_token: z.string() }).parse(await tokenResponse.json())

  const url = new URL('/api/oauth2/v2/identity', patreonOrigin)
  url.search = new URLSearchParams({
    include: 'memberships,memberships.campaign',
    'fields[member]': 'patron_status,currently_entitled_amount_cents,next_charge_date',
  }).toString()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) throw new PatreonConnectError(`Patreon wouldn't say who this is (${response.status})`)
  return identitySchema.parse(await response.json())
}

export type PatreonConnectProblem = 'expired' | 'taken'

// Finishes connecting, returning why it couldn't, if so.
export async function connectPatreon(input: {
  userId: string
  state: string | null
  code: string | null
  origin: string
}): Promise<{ error: PatreonConnectProblem | null }> {
  if (!input.state || pendingConnections.take(input.state) !== input.userId || !input.code) {
    return { error: 'expired' }
  }
  const config = await getPatreonConfig()
  if (!config) return { error: 'expired' }
  const identity = await fetchIdentity(input.code, input.origin, config)
  const [other] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, 'patreon'), eq(subscriptions.externalId, identity.data.id)))
    .limit(1)
  // One pledge pays for one account.
  if (other && other.userId !== input.userId) {
    return { error: 'taken' }
  }
  const member =
    identity.included.flatMap((item) => {
      const parsed = memberSchema.safeParse(item)
      return parsed.success && isOurCampaign(parsed.data, config) ? [parsed.data] : []
    })[0] ?? null
  await recordSubscription({
    userId: input.userId,
    provider: 'patreon',
    externalId: identity.data.id,
    ...(await subscriptionFrom(member)),
  })
  // A user has one Patreon account at a time.
  await disconnectPatreon(input.userId, { keeping: identity.data.id })
  return { error: null }
}

export async function disconnectPatreon(userId: string, { keeping }: { keeping?: string } = {}) {
  const rows = await db
    .select({ id: subscriptions.id, externalId: subscriptions.externalId, active: subscriptions.active })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.provider, 'patreon')))
  const leaving = rows.filter((row) => row.externalId !== keeping)
  if (!leaving.length) return
  for (const row of leaving) await db.delete(subscriptions).where(eq(subscriptions.id, row.id))
  const [stillActive] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.active, true)))
    .limit(1)
  if (leaving.some((row) => row.active) && !stillActive) await startGrace(userId)
}

// --- Webhooks ------------------------------------------------------------------

const deleteEvents = new Set(['members:delete', 'members:pledge:delete'])

// Patreon signs the raw body with HMAC-MD5, its only option.
export async function validPatreonSignature(body: string, signature: string | null) {
  const config = await getPatreonConfig()
  if (!config || !signature) return false
  const expected = Buffer.from(createHmac('md5', config.webhookSecret).update(body).digest('hex'))
  const given = Buffer.from(signature)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// Updates the pledge of a user who has connected. Those who haven't yet are
// ignored, as connecting reads their pledge anyway.
export async function handlePatreonWebhook(body: string, event: string | null) {
  const member = memberSchema.parse(z.object({ data: z.unknown() }).parse(JSON.parse(body)).data)
  const config = await getPatreonConfig()
  if (!config || !isOurCampaign(member, config)) return
  const patreonUserId = member.relationships?.user?.data?.id
  if (!patreonUserId) {
    logger.warn({ event }, 'Patreon webhook without a user')
    return
  }
  const [existing] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, 'patreon'), eq(subscriptions.externalId, patreonUserId)))
    .limit(1)
  if (!existing) return
  await recordSubscription({
    userId: existing.userId,
    provider: 'patreon',
    externalId: patreonUserId,
    ...(await subscriptionFrom(event && deleteEvents.has(event) ? null : member)),
  })
}
