// Site-wide settings that admins edit (see the admin page), kept in the one
// row of site_setting. They're read for every download, so they're cached
// briefly; a change on this server applies at once.
import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { siteSettings, type SiteSettings } from '~/server/db/schema'

const id = 'global'
const cacheMs = 30_000

// Used if the row is somehow missing (the migration makes it).
const defaults: SiteSettings = {
  id,
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
  updatedAt: new Date(0),
}

let cached: { settings: SiteSettings; at: number } | null = null

export async function getSiteSettings(): Promise<SiteSettings> {
  if (cached && Date.now() - cached.at < cacheMs) return cached.settings
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, id)).limit(1)
  cached = { settings: row ?? defaults, at: Date.now() }
  return cached.settings
}

export async function updateSiteSettings(input: Partial<Omit<SiteSettings, 'id' | 'updatedAt'>>) {
  const [row] = await db
    .insert(siteSettings)
    .values({ ...defaults, ...input, id, updatedAt: undefined })
    .onConflictDoUpdate({ target: siteSettings.id, set: input })
    .returning()
  cached = { settings: row!, at: Date.now() }
  return row!
}
