// Site-wide settings that admins edit (see the admin page), kept in
// site_settings as one row per setting that has been saved; the rest have the
// defaults below. A new setting only needs adding here (and to the admin
// page), not a migration. They're read for every download, so they're cached
// briefly; a change on this server applies at once. Keys starting "__" are
// the app's own values (such as the day's visitor salt), never read or written
// as settings.
import '@tanstack/react-start/server-only'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { landingCopySchema } from '~/lib/branding-schema'
import { db } from '~/server/db/client.server'
import { siteSettings } from '~/server/db/schema'
import { logger } from '~/server/logger.server'

const cacheMs = 30_000

// Each setting's type, which what's stored must match.
const settingSchemas = {
  // At most this many downloads from the platforms at once, for all users.
  downloadConcurrency: z.number().int(),
  // And at most this many from any one platform.
  perPlatformConcurrency: z.number().int(),
  // The least time between starting two requests to the same platform.
  downloadDelaySeconds: z.number().int(),
  // How often each channel is checked for new uploads.
  channelCheckHours: z.number().int(),
  // Passed to yt-dlp's --limit-rate (e.g. "2M"); unlimited when null.
  downloadRateLimit: z.string().nullable(),
  // The SMTP server for email, when it isn't set by environment variables
  // (see email.server.ts). The password is encrypted (secrets.server.ts).
  smtpHost: z.string().nullable(),
  smtpPort: z.number().int(),
  smtpSecure: z.boolean(),
  smtpUser: z.string().nullable(),
  smtpPassword: z.string().nullable(),
  emailFrom: z.string().nullable(),
  // The site's branding (see branding.server.ts); null for the default.
  siteName: z.string().nullable(),
  siteTagline: z.string().nullable(),
  siteDescription: z.string().nullable(),
  contactEmail: z.string().nullable(),
  logoVersion: z.string().nullable(),
  // Only the parts of the landing page's copy that differ from the default.
  landingCopy: landingCopySchema.partial().nullable(),
  privacyHtml: z.string().nullable(),
  termsHtml: z.string().nullable(),
  analyticsScriptUrl: z.string().nullable(),
  analyticsAttributes: z.record(z.string(), z.string()),
}

export type SiteSettings = { [K in keyof typeof settingSchemas]: z.infer<(typeof settingSchemas)[K]> }
type SettingName = keyof SiteSettings

export const defaultSiteSettings: SiteSettings = {
  downloadConcurrency: 3,
  perPlatformConcurrency: 2,
  downloadDelaySeconds: 10,
  channelCheckHours: 6,
  downloadRateLimit: null,
  smtpHost: null,
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: null,
  smtpPassword: null,
  emailFrom: null,
  siteName: null,
  siteTagline: null,
  siteDescription: null,
  contactEmail: null,
  logoVersion: null,
  landingCopy: null,
  privacyHtml: null,
  termsHtml: null,
  analyticsScriptUrl: null,
  analyticsAttributes: {},
}

const isSettingName = (key: string): key is SettingName => Object.hasOwn(settingSchemas, key)

// The prefix of keys the app keeps in site_settings for itself.
export const internalKeyPrefix = '__'

let cached: { settings: SiteSettings; at: number } | null = null

// The saved settings over the defaults. A stored value of the wrong type (or a
// setting that no longer exists) is ignored, with a warning, rather than
// breaking whatever reads it.
export async function getSiteSettings(): Promise<SiteSettings> {
  if (cached && Date.now() - cached.at < cacheMs) return cached.settings
  const rows = await db.select({ key: siteSettings.key, value: siteSettings.value }).from(siteSettings)
  const settings: Record<string, unknown> = { ...defaultSiteSettings }
  for (const { key, value } of rows) {
    if (key.startsWith(internalKeyPrefix)) continue
    if (!isSettingName(key)) {
      logger.warn({ key }, 'Ignoring an unknown site setting')
      continue
    }
    const parsed = settingSchemas[key].safeParse(value)
    if (parsed.success) settings[key] = parsed.data
    else logger.warn({ key }, 'Ignoring a site setting of the wrong type; using its default')
  }
  cached = { settings: settings as SiteSettings, at: Date.now() }
  return cached.settings
}

// Saves the given settings, leaving the others as they are, and returns them all.
export async function updateSiteSettings(input: Partial<SiteSettings>) {
  const rows = Object.entries(input).flatMap(([key, value]) => {
    if (value === undefined || !isSettingName(key)) return []
    // As a JSON string cast to jsonb, so null is stored as JSON null.
    return [{ key, value: sql`${JSON.stringify(settingSchemas[key].parse(value))}::jsonb` }]
  })
  if (rows.length > 0) {
    await db
      .insert(siteSettings)
      .values(rows)
      .onConflictDoUpdate({ target: siteSettings.key, set: { value: sql`excluded.value`, updatedAt: new Date() } })
  }
  cached = null
  return getSiteSettings()
}
