import { z } from 'zod'

// A secret is only sent to change it: left empty, the saved one is kept.
const secret = (prefixes: string[], message: string) =>
  z
    .string()
    .trim()
    .max(500)
    .refine((value) => !value || prefixes.some((prefix) => value.startsWith(prefix)), message)

// The Stripe details admins can enter when they aren't set by environment variables.
export const stripeSettingsSchema = z.object({
  secretKey: secret(['sk_', 'rk_'], 'Use the secret key, which starts sk_ or rk_'),
  webhookSecret: secret(['whsec_'], 'Use the signing secret, which starts whsec_'),
  priceId: z.string().trim().regex(/^price_\w+$/, 'Use the price ID, which starts price_'),
})
export type StripeSettingsInput = z.infer<typeof stripeSettingsSchema>

// The same for Patreon.
export const patreonSettingsSchema = z.object({
  clientId: z.string().trim().min(1, 'Enter the client ID').max(500),
  // Secrets, as above.
  clientSecret: z.string().trim().max(500),
  webhookSecret: z.string().trim().max(500),
  campaignId: z.string().trim().regex(/^\S{1,100}$/, 'Enter the campaign ID'),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((value) => !value || /^https:\/\/\S+$/.test(value), 'Use an https:// address'),
})
export type PatreonSettingsInput = z.infer<typeof patreonSettingsSchema>
