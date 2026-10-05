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
