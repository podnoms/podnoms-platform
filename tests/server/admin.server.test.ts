import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAdminOverview, saveSiteSettings, setUserChannelLimit } from '~/server/admin.server'
import { channels, users } from '~/server/db/schema'
import { updateSiteSettings } from '~/server/site-settings.server'
import { resetDb } from '../db'
import { createPodcast, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))
afterEach(() => updateSiteSettings({ downloadConcurrency: 3, perPlatformConcurrency: 2, downloadDelaySeconds: 0, channelCheckHours: 6, downloadRateLimit: null }))

describe('the admin page', () => {
  it('shows the settings, the downloads and each user with how many channels they follow', async () => {
    const user = await createUser({ email: 'a@example.com' })
    const podcast = await createPodcast(user.id)
    await db.insert(channels).values({ podcastId: podcast.id, platform: 'youtube', url: 'https://www.youtube.com/@x/videos' })
    await createUser({ email: 'b@example.com', channelEpisodeLimit: 4 })

    const overview = await getAdminOverview()
    expect(overview.settings).toEqual({
      downloadConcurrency: 3,
      perPlatformConcurrency: 2,
      downloadDelaySeconds: 0,
      channelCheckHours: 6,
      downloadRateLimit: null,
    })
    expect(overview.throttle).toEqual({ running: [], waiting: [], cooldowns: [] })
    expect(overview.users.map(({ email, channels, channelEpisodeLimit }) => ({ email, channels, channelEpisodeLimit }))).toEqual([
      { email: 'a@example.com', channels: 1, channelEpisodeLimit: 10 },
      { email: 'b@example.com', channels: 0, channelEpisodeLimit: 4 },
    ])
    expect(overview.jobsRunning).toBe(false)
  })

  it('saves the settings', async () => {
    await saveSiteSettings({ downloadConcurrency: 4, perPlatformConcurrency: 1, downloadDelaySeconds: 30, channelCheckHours: 12, downloadRateLimit: '1M' })
    expect((await getAdminOverview()).settings).toMatchObject({ downloadConcurrency: 4, downloadDelaySeconds: 30, downloadRateLimit: '1M' })
  })

  it("sets a user's channel limit", async () => {
    const user = await createUser()
    expect(await setUserChannelLimit(user.id, 25)).toBe(true)
    const [row] = await db.select({ limit: users.channelEpisodeLimit }).from(users).where(eq(users.id, user.id))
    expect(row!.limit).toBe(25)
    expect(await setUserChannelLimit('nobody', 5)).toBe(false)
  })
})
