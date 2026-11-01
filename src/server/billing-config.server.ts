// The details of the billing providers. For each provider, those in environment
// variables if its first one is set, otherwise those admins entered on the admin
// page, and none (that provider is off) if neither is complete. Saved secrets
// are encrypted (secrets.server.ts) and never sent to the browser.
import '@tanstack/react-start/server-only'
import { env } from '~/env'
import type { PatreonSettingsInput } from '~/lib/billing-schema'
import { logger } from '~/server/logger.server'
import { decryptSecret, encryptSecret, type SecretPurpose } from '~/server/secrets.server'
import { getSiteSettings, updateSiteSettings } from '~/server/site-settings.server'

export type StripeConfig = { source: 'env' | 'admin'; secretKey: string; webhookSecret: string; priceId: string }

export type PatreonConfig = {
  source: 'env' | 'admin'
  clientId: string
  clientSecret: string
  webhookSecret: string
  campaignId: string
  url: string | null
}

const stripePurpose: SecretPurpose = 'podnoms stripe secret'
const patreonPurpose: SecretPurpose = 'podnoms patreon secret'

// A secret saved under another AUTH_SECRET can't be read. The provider is then
// off until an admin enters it again, as the admin page says.
let warnedUnreadable = false
function readSecret(purpose: SecretPurpose, stored: string | null) {
  if (!stored) return null
  try {
    return decryptSecret(purpose, stored)
  } catch {
    if (!warnedUnreadable) logger.warn({ purpose }, 'A saved billing secret can’t be decrypted (has AUTH_SECRET changed?)')
    warnedUnreadable = true
    return null
  }
}

export async function savedStripeDetails() {
  const settings = await getSiteSettings()
  return {
    secretKey: readSecret(stripePurpose, settings.stripeSecretKey),
    webhookSecret: readSecret(stripePurpose, settings.stripeWebhookSecret),
    priceId: settings.stripePriceId,
  }
}

async function savedPatreonDetails() {
  const settings = await getSiteSettings()
  return {
    clientId: settings.patreonClientId,
    clientSecret: readSecret(patreonPurpose, settings.patreonClientSecret),
    webhookSecret: readSecret(patreonPurpose, settings.patreonWebhookSecret),
    campaignId: settings.patreonCampaignId,
    url: settings.patreonUrl,
  }
}

export async function getStripeConfig(): Promise<StripeConfig | null> {
  if (env.STRIPE_SECRET_KEY) {
    if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_PRICE_ID) return null
    return {
      source: 'env',
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      priceId: env.STRIPE_PRICE_ID,
    }
  }
  const { secretKey, webhookSecret, priceId } = await savedStripeDetails()
  return secretKey && webhookSecret && priceId ? { source: 'admin', secretKey, webhookSecret, priceId } : null
}

export async function getPatreonConfig(): Promise<PatreonConfig | null> {
  if (env.PATREON_CLIENT_ID) {
    if (!env.PATREON_CLIENT_SECRET || !env.PATREON_WEBHOOK_SECRET || !env.PATREON_CAMPAIGN_ID) return null
    return {
      source: 'env',
      clientId: env.PATREON_CLIENT_ID,
      clientSecret: env.PATREON_CLIENT_SECRET,
      webhookSecret: env.PATREON_WEBHOOK_SECRET,
      campaignId: env.PATREON_CAMPAIGN_ID,
      url: env.PATREON_URL ?? null,
    }
  }
  const { clientId, clientSecret, webhookSecret, campaignId, url } = await savedPatreonDetails()
  return clientId && clientSecret && webhookSecret && campaignId
    ? { source: 'admin', clientId, clientSecret, webhookSecret, campaignId, url }
    : null
}

export async function billingConfigured() {
  return (await getStripeConfig()) !== null || (await getPatreonConfig()) !== null
}

// The details for the admin page: never the secrets, just whether there are any.
export async function getBillingDetails() {
  const settings = await getSiteSettings()
  const [stripe, patreon, savedStripe, savedPatreon] = await Promise.all([
    getStripeConfig(),
    getPatreonConfig(),
    savedStripeDetails(),
    savedPatreonDetails(),
  ])
  return {
    stripe: {
      configured: stripe !== null,
      locked: Boolean(env.STRIPE_SECRET_KEY),
      testMode: stripe ? /^[sr]k_test_/.test(stripe.secretKey) : false,
      priceId: stripe?.priceId ?? savedStripe.priceId ?? '',
      hasSecretKey: stripe !== null || savedStripe.secretKey !== null,
      hasWebhookSecret: stripe !== null || savedStripe.webhookSecret !== null,
      unreadable:
        (settings.stripeSecretKey !== null && savedStripe.secretKey === null) ||
        (settings.stripeWebhookSecret !== null && savedStripe.webhookSecret === null),
    },
    patreon: {
      configured: patreon !== null,
      locked: Boolean(env.PATREON_CLIENT_ID),
      clientId: patreon?.clientId ?? savedPatreon.clientId ?? '',
      campaignId: patreon?.campaignId ?? savedPatreon.campaignId ?? '',
      url: patreon?.url ?? savedPatreon.url ?? '',
      hasClientSecret: patreon !== null || savedPatreon.clientSecret !== null,
      hasWebhookSecret: patreon !== null || savedPatreon.webhookSecret !== null,
      unreadable:
        (settings.patreonClientSecret !== null && savedPatreon.clientSecret === null) ||
        (settings.patreonWebhookSecret !== null && savedPatreon.webhookSecret === null),
    },
  }
}

// Saves what's already been checked, by saveStripeSettings in stripe.server.ts.
export async function storeStripeDetails(details: { secretKey: string; webhookSecret: string; priceId: string }) {
  await updateSiteSettings({
    stripeSecretKey: encryptSecret(stripePurpose, details.secretKey),
    stripeWebhookSecret: encryptSecret(stripePurpose, details.webhookSecret),
    stripePriceId: details.priceId,
  })
}

const envSetsPatreon = 'Patreon is set by environment variables, so it can’t be changed here'

// Returns why the details couldn't be saved, if so.
export async function savePatreonSettings(input: PatreonSettingsInput): Promise<{ error: string | null }> {
  if (env.PATREON_CLIENT_ID) return { error: envSetsPatreon }
  const saved = await savedPatreonDetails()
  const clientSecret = input.clientSecret || saved.clientSecret
  const webhookSecret = input.webhookSecret || saved.webhookSecret
  if (!clientSecret) return { error: 'Enter the client secret' }
  if (!webhookSecret) return { error: 'Enter the webhook secret' }
  await updateSiteSettings({
    patreonClientId: input.clientId,
    patreonClientSecret: encryptSecret(patreonPurpose, clientSecret),
    patreonWebhookSecret: encryptSecret(patreonPurpose, webhookSecret),
    patreonCampaignId: input.campaignId,
    patreonUrl: input.url || null,
  })
  return { error: null }
}

// Removing the only provider while paid features are on would make everything
// free without anyone having chosen that, and leave nobody able to subscribe.
async function removalProblem(remaining: () => Promise<unknown>) {
  const { paidFeaturesStartedAt } = await getSiteSettings()
  return paidFeaturesStartedAt !== null && !(await remaining()) ? 'Turn off paid features before removing the only provider' : null
}

export async function removeStripeSettings(): Promise<{ error: string | null }> {
  if (env.STRIPE_SECRET_KEY) return { error: 'Stripe is set by environment variables, so it can’t be changed here' }
  const error = await removalProblem(getPatreonConfig)
  if (error) return { error }
  await updateSiteSettings({ stripeSecretKey: null, stripeWebhookSecret: null, stripePriceId: null })
  return { error: null }
}

export async function removePatreonSettings(): Promise<{ error: string | null }> {
  if (env.PATREON_CLIENT_ID) return { error: envSetsPatreon }
  const error = await removalProblem(getStripeConfig)
  if (error) return { error }
  await updateSiteSettings({
    patreonClientId: null,
    patreonClientSecret: null,
    patreonWebhookSecret: null,
    patreonCampaignId: null,
    patreonUrl: null,
  })
  return { error: null }
}
