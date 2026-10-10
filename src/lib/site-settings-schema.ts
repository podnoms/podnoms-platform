import { z } from 'zod'

const whole = (min: number, max: number, what: string) =>
  z.coerce.number().int(`${what} must be a whole number`).min(min, `${what} must be at least ${min}`).max(max, `${what} must be at most ${max}`)

// Site-wide download settings, edited by admins.
export const siteSettingsSchema = z
  .object({
    downloadConcurrency: whole(1, 10, 'Downloads at once'),
    perPlatformConcurrency: whole(1, 10, 'Downloads at once per platform'),
    downloadDelaySeconds: whole(0, 600, 'The delay'),
    channelCheckHours: whole(1, 168, 'The check interval'),
    // yt-dlp's --limit-rate: bytes a second, optionally with K or M.
    downloadRateLimit: z
      .string()
      .trim()
      .regex(/^(\d+(\.\d+)?[KMkm]?)?$/, 'Use a number of bytes a second, like 500K or 2M')
      .transform((value) => value || null)
      .nullable(),
  })
  .refine((s) => s.perPlatformConcurrency <= s.downloadConcurrency, {
    message: "Downloads per platform can't be more than downloads at once",
    path: ['perPlatformConcurrency'],
  })
export type SiteSettingsInput = z.infer<typeof siteSettingsSchema>

export const userChannelLimitSchema = z.object({ userId: z.string().min(1), limit: whole(0, 50, 'The limit') })

// An email address, optionally with a name: "podnoms <hello@podnoms.com>".
const mailbox = /^(?:[^<>@]*<\s*[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+\s*>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/

// The SMTP server admins can enter when it isn't set by environment variables.
// An empty host turns email off. The password is only sent to change it: left
// empty, the saved one is kept unless clearPassword is set.
export const emailSettingsSchema = z
  .object({
    smtpHost: z
      .string()
      .trim()
      .max(255)
      .nullable()
      .transform((value) => value || null),
    smtpPort: whole(1, 65535, 'The port'),
    smtpSecure: z.boolean(),
    smtpUser: z
      .string()
      .trim()
      .max(255)
      .nullable()
      .transform((value) => value || null),
    smtpPassword: z.string().max(1000),
    clearPassword: z.boolean(),
    emailFrom: z
      .string()
      .trim()
      .max(255)
      .nullable()
      .transform((value) => value || null)
      .refine((value) => value === null || mailbox.test(value), 'Use an address, like podnoms <hello@example.com>'),
  })
  .refine((settings) => !settings.smtpHost || settings.emailFrom, {
    message: 'Say who emails come from',
    path: ['emailFrom'],
  })
export type EmailSettingsInput = z.infer<typeof emailSettingsSchema>

// Sending a test email: to whom, and, unless the environment sets the server,
// with the settings as they are in the form, saved or not.
export const testEmailSchema = z.object({
  to: z.string().trim().pipe(z.email('Enter a valid email address')),
  settings: emailSettingsSchema.optional(),
})
