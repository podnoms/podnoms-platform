import Stripe from 'stripe'
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBillingDetails, getPatreonConfig, getStripeConfig, removePatreonSettings, removeStripeSettings, savePatreonSettings } from '~/server/billing-config.server'
import { siteSettings } from '~/server/db/schema'
import { handlePatreonWebhook, patreonAuthorizeUrl, validPatreonSignature } from '~/server/patreon.server'
import { handleStripeWebhook, InvalidWebhookError, saveStripeSettings, setStripeClient } from '~/server/stripe.server'
import { getSubscriptionAdmin, paidFeaturesEnforced, setPaidFeaturesEnforced } from '~/server/subscriptions.server'
import { updateSiteSettings } from '~/server/site-settings.server'
import { resetDb } from '../db'
import { db } from '../helpers'

// Runs ahead of the imports, so src/env.ts sees no provider in the environment.
vi.hoisted(() => {
  for (const name of Object.keys(process.env)) if (/^(STRIPE|PATREON)_/.test(name)) delete process.env[name]
})

const stripeInput = { secretKey: 'sk_test_saved', webhookSecret: 'whsec_saved', priceId: 'price_1' }
const patreonInput = { clientId: 'client', clientSecret: 'client-secret', webhookSecret: 'hook-secret', campaignId: 'c1', url: '' }

function fakeStripe(retrieve: () => Promise<object>) {
  setStripeClient({ prices: { retrieve: vi.fn(retrieve) }, webhooks: new Stripe('sk_test_x').webhooks } as unknown as Stripe)
}

const recurring = async () => ({ recurring: { interval: 'month' } })

const clearSaved = () =>
  updateSiteSettings({
    paidFeaturesStartedAt: null,
    stripeSecretKey: null,
    stripeWebhookSecret: null,
    stripePriceId: null,
    patreonClientId: null,
    patreonClientSecret: null,
    patreonWebhookSecret: null,
    patreonCampaignId: null,
    patreonUrl: null,
  })

beforeEach(async () => {
  await resetDb(db)
  await clearSaved()
})

afterEach(() => setStripeClient(null))

describe('Stripe details', () => {
  it('saves them encrypted, and uses them', async () => {
    fakeStripe(recurring)
    expect(await saveStripeSettings(stripeInput)).toEqual({ error: null })
    expect(await getStripeConfig()).toEqual({ source: 'admin', ...stripeInput })
    const rows = await db.select().from(siteSettings)
    expect(JSON.stringify(rows)).not.toContain('sk_test_saved')
    expect(JSON.stringify(rows)).not.toContain('whsec_saved')
  })

  it('keeps saved secrets when they are left empty', async () => {
    fakeStripe(recurring)
    await saveStripeSettings(stripeInput)
    expect(await saveStripeSettings({ secretKey: '', webhookSecret: '', priceId: 'price_2' })).toEqual({ error: null })
    expect(await getStripeConfig()).toEqual({ source: 'admin', ...stripeInput, priceId: 'price_2' })
  })

  it('needs the secrets the first time', async () => {
    fakeStripe(recurring)
    expect((await saveStripeSettings({ ...stripeInput, secretKey: '' })).error).toMatch(/secret key/)
    expect((await saveStripeSettings({ ...stripeInput, webhookSecret: '' })).error).toMatch(/signing secret/)
    expect(await getStripeConfig()).toBeNull()
  })

  it.each([
    ['a refused key', async () => { throw Object.assign(new Error('no'), { type: 'StripeAuthenticationError' }) }, /refused/],
    ['an unknown price', async () => { throw Object.assign(new Error('no'), { code: 'resource_missing' }) }, /no such price/],
    ['a one-off price', async () => ({ recurring: null }), /one-off/],
    ['Stripe being unreachable', async () => { throw new Error('down') }, /try again/],
  ])('saves nothing with %s', async (_, retrieve, message) => {
    fakeStripe(retrieve)
    expect((await saveStripeSettings(stripeInput)).error).toMatch(message)
    expect(await getStripeConfig()).toBeNull()
  })

  it('checks webhooks against the saved signing secret', async () => {
    fakeStripe(recurring)
    await saveStripeSettings(stripeInput)
    const real = new Stripe('sk_test_x')
    const body = JSON.stringify({ id: 'evt', object: 'event', type: 'invoice.paid', data: { object: {} } })
    const good = real.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_saved' })
    const bad = real.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_other' })
    await expect(handleStripeWebhook(body, good)).resolves.toBeUndefined()
    await expect(handleStripeWebhook(body, bad)).rejects.toBeInstanceOf(InvalidWebhookError)
  })
})

describe('Patreon details', () => {
  it('saves them encrypted, and uses them', async () => {
    expect(await savePatreonSettings(patreonInput)).toEqual({ error: null })
    expect(await getPatreonConfig()).toMatchObject({ source: 'admin', clientId: 'client', campaignId: 'c1', url: null })
    expect(JSON.stringify(await db.select().from(siteSettings))).not.toContain('hook-secret')

    expect(new URL(await patreonAuthorizeUrl('user', 'https://site.test')).searchParams.get('client_id')).toBe('client')
    const signature = createHmac('md5', 'hook-secret').update('{}').digest('hex')
    expect(await validPatreonSignature('{}', signature)).toBe(true)
    await expect(handlePatreonWebhook(JSON.stringify({ data: { id: 'm', type: 'member' } }), 'members:pledge:update')).resolves.toBeUndefined()
  })

  it('needs the secrets the first time', async () => {
    expect((await savePatreonSettings({ ...patreonInput, clientSecret: '' })).error).toMatch(/client secret/)
    expect(await getPatreonConfig()).toBeNull()
  })
})

describe('what the admin page gets', () => {
  it('never includes the secrets', async () => {
    fakeStripe(recurring)
    await saveStripeSettings(stripeInput)
    await savePatreonSettings(patreonInput)
    const json = JSON.stringify(await getSubscriptionAdmin('https://site.test'))
    for (const secret of [stripeInput.secretKey, stripeInput.webhookSecret, patreonInput.clientSecret, patreonInput.webhookSecret]) {
      expect(json).not.toContain(secret)
    }
    expect(await getBillingDetails()).toMatchObject({
      stripe: { configured: true, locked: false, testMode: true, hasSecretKey: true, priceId: 'price_1' },
      patreon: { configured: true, locked: false, hasClientSecret: true, clientId: 'client' },
    })
  })

  it('says when a saved secret can no longer be read, and treats the provider as off', async () => {
    fakeStripe(recurring)
    await saveStripeSettings(stripeInput)
    await updateSiteSettings({ stripeSecretKey: 'AAAA.AAAA.AAAA' })
    expect(await getStripeConfig()).toBeNull()
    expect((await getBillingDetails()).stripe).toMatchObject({ configured: false, unreadable: true, hasSecretKey: false })
  })
})

describe('turning paid features on', () => {
  it('works with saved details', async () => {
    await expect(setPaidFeaturesEnforced(true)).rejects.toThrow(/Set up/)
    await savePatreonSettings(patreonInput)
    await setPaidFeaturesEnforced(true)
    expect(await paidFeaturesEnforced()).toBe(true)
  })

  it("won't remove the only provider while they're on", async () => {
    await savePatreonSettings(patreonInput)
    await setPaidFeaturesEnforced(true)
    expect((await removePatreonSettings()).error).toMatch(/Turn off/)
    expect(await getPatreonConfig()).not.toBeNull()

    fakeStripe(recurring)
    await saveStripeSettings(stripeInput)
    expect(await removePatreonSettings()).toEqual({ error: null })
    expect((await removeStripeSettings()).error).toMatch(/Turn off/)

    await setPaidFeaturesEnforced(false)
    expect(await removeStripeSettings()).toEqual({ error: null })
    expect(await getStripeConfig()).toBeNull()
  })
})
