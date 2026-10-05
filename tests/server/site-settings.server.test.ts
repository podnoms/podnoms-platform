import { afterEach, describe, expect, it } from 'vitest'
import { siteSettings } from '~/server/db/schema'
import { getSiteSettings, updateSiteSettings } from '~/server/site-settings.server'
import { db } from '../helpers'

// The settings outlive resetDb, so each test puts back what it changes.
afterEach(() => updateSiteSettings({ downloadConcurrency: 3, downloadDelaySeconds: 0, downloadRateLimit: null }))

describe('site settings', () => {
  it('start as the migration made them', async () => {
    expect(await getSiteSettings()).toMatchObject({
      id: 'global',
      downloadConcurrency: 3,
      perPlatformConcurrency: 2,
      channelCheckHours: 6,
      downloadRateLimit: null,
    })
  })

  it('are changed at once', async () => {
    await getSiteSettings()
    await updateSiteSettings({ downloadConcurrency: 5, downloadRateLimit: '2M' })
    expect(await getSiteSettings()).toMatchObject({ downloadConcurrency: 5, perPlatformConcurrency: 2, downloadRateLimit: '2M' })
    expect(await db.select().from(siteSettings)).toHaveLength(1)
  })
})
