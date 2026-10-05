// The admin page: site-wide download settings, the state of the download
// throttle, and each user's channel import limit. Callers check isAdmin.
import '@tanstack/react-start/server-only'
import { asc, count, eq } from 'drizzle-orm'
import { env } from '~/env'
import type { Platform } from '~/lib/platforms'
import type { SiteSettingsInput } from '~/lib/site-settings-schema'
import { db } from '~/server/db/client.server'
import { channels, podcasts, users } from '~/server/db/schema'
import { clearCooldown, pump, throttleStatus } from '~/server/download-throttle.server'
import { getSiteSettings, updateSiteSettings } from '~/server/site-settings.server'

export async function getAdminOverview() {
  const [settings, userRows] = await Promise.all([
    getSiteSettings(),
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
  const { updatedAt: _, id: __, ...editable } = settings
  return {
    settings: editable,
    throttle: throttleStatus(),
    users: userRows,
    // Channels are only checked by the job queue.
    jobsRunning: Boolean(env.REDIS_URL),
  }
}

export async function saveSiteSettings(input: SiteSettingsInput) {
  await updateSiteSettings(input)
  // More slots, or a shorter delay, can let waiting downloads start now.
  void pump()
}

export async function setUserChannelLimit(userId: string, limit: number) {
  const updated = await db.update(users).set({ channelEpisodeLimit: limit }).where(eq(users.id, userId)).returning({ id: users.id })
  return updated.length > 0
}

export function endCooldown(platform: Platform) {
  clearCooldown(platform)
}
