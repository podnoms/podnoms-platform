// The admin page: site-wide download and email settings, the state of the
// download throttle, each user's channel import limit, and moderation (how
// strict the image check is, and reports). Callers check isAdmin.
import '@tanstack/react-start/server-only'
import { asc, count, eq } from 'drizzle-orm'
import { env } from '~/env'
import type { Platform } from '~/lib/platforms'
import type { EmailSettingsInput, SiteSettingsInput } from '~/lib/site-settings-schema'
import { db } from '~/server/db/client.server'
import { channels, podcasts, users } from '~/server/db/schema'
import { clearCooldown, pump, throttleStatus } from '~/server/download-throttle.server'
import { fetcherHealth } from '~/server/fetcher.server'
import { configFromSettings, getEmailConfig, getEmailStatus, sendEmail, updateEmailSettings } from '~/server/email.server'
import { testEmail } from '~/server/emails.server'
import type { ImageModerationLimits } from '~/lib/image-moderation'
import { imageModerationEnabled } from '~/server/image-moderation.server'
import { cloudflare, listOpenReports } from '~/server/reports.server'
import { getSiteSettings, updateSiteSettings } from '~/server/site-settings.server'
import { getBranding } from '~/server/branding.server'

export async function getAdminOverview() {
  const [settings, fetcher, reports, userRows] = await Promise.all([
    getSiteSettings(),
    fetcherHealth(),
    listOpenReports(),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isAdmin: users.isAdmin,
        channelEpisodeLimit: users.channelEpisodeLimit,
        channels: count(channels.id),
      })
      .from(users)
      .leftJoin(podcasts, eq(podcasts.userId, users.id))
      .leftJoin(channels, eq(channels.podcastId, podcasts.id))
      .groupBy(users.id)
      .orderBy(asc(users.email)),
  ])
  return {
    // Only the download settings: email has its own section, without the password.
    settings: {
      downloadConcurrency: settings.downloadConcurrency,
      perPlatformConcurrency: settings.perPlatformConcurrency,
      downloadDelaySeconds: settings.downloadDelaySeconds,
      channelCheckHours: settings.channelCheckHours,
      downloadRateLimit: settings.downloadRateLimit,
    },
    email: await getEmailStatus(),
    throttle: throttleStatus(),
    // The remote fetcher's state, or null when yt-dlp runs here.
    fetcher,
    users: userRows,
    // Channels are only checked by the job queue.
    jobsRunning: Boolean(env.REDIS_URL),
    moderation: {
      // Whether images are checked at all (Azure Content Safety is set up).
      checking: imageModerationEnabled(),
      limits: settings.imageModeration,
      // Whether removed images can be purged from Cloudflare's cache.
      purging: Boolean(cloudflare.zoneId && cloudflare.token),
      reports,
    },
  }
}

export async function saveSiteSettings(input: SiteSettingsInput) {
  await updateSiteSettings(input)
  // More slots, or a shorter delay, can let waiting downloads start now.
  void pump()
}

export async function saveImageModeration(limits: ImageModerationLimits) {
  await updateSiteSettings({ imageModeration: limits })
}

export async function setUserChannelLimit(userId: string, limit: number) {
  const updated = await db.update(users).set({ channelEpisodeLimit: limit }).where(eq(users.id, userId)).returning({ id: users.id })
  return updated.length > 0
}

export function endCooldown(platform: Platform) {
  clearCooldown(platform)
}

export const saveEmailSettings = (input: EmailSettingsInput) => updateEmailSettings(input)

// Sends a test email, with the settings as entered (saved or not) unless the
// environment sets the server. Returns the server's error, for the admin to see.
export async function sendTestEmail(to: string, settings?: EmailSettingsInput) {
  const config = env.SMTP_HOST || !settings ? await getEmailConfig() : await configFromSettings(settings)
  if (!config) return { ok: false as const, error: 'Enter an SMTP host and a from address first.' }
  try {
    await sendEmail({ to, ...testEmail((await getBranding()).name) }, config)
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}
