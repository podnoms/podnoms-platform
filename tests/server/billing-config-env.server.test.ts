import { describe, expect, it } from 'vitest'
import { getBillingDetails, getStripeConfig, removeStripeSettings, savePatreonSettings } from '~/server/billing-config.server'
import { saveStripeSettings } from '~/server/stripe.server'

// tests/setup.ts sets the providers in the environment.
describe('details from the environment', () => {
  it('are used, and lock what admins can change', async () => {
    expect(await getStripeConfig()).toMatchObject({ source: 'env', priceId: 'price_test' })
    expect(await getBillingDetails()).toMatchObject({ stripe: { locked: true }, patreon: { locked: true } })
    expect((await saveStripeSettings({ secretKey: 'sk_x', webhookSecret: 'whsec_x', priceId: 'price_x' })).error).toMatch(/environment/)
    expect((await removeStripeSettings()).error).toMatch(/environment/)
    const patreon = { clientId: 'x', clientSecret: 'x', webhookSecret: 'x', campaignId: 'x', url: '' }
    expect((await savePatreonSettings(patreon)).error).toMatch(/environment/)
  })
})
