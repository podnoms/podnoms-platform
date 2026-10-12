import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { siteSettings } from '~/server/db/schema'
import { defaultSiteSettings, getSiteSettings, updateSiteSettings, type SiteSettings } from '~/server/site-settings.server'
import { db } from '../helpers'

// The settings outlive resetDb, so each test puts back what it changes: only
// the delay is saved (as 0, by tests/db.ts).
afterEach(async () => {
  await db.delete(siteSettings)
  await updateSiteSettings({ downloadDelaySeconds: 0 })
})

describe('site settings', () => {
  it('start as the migration made them', async () => {
    expect(await getSiteSettings()).toMatchObject({
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
    const rows = await db.select({ key: siteSettings.key, value: siteSettings.value }).from(siteSettings)
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: 'downloadConcurrency', value: 5 },
        { key: 'downloadRateLimit', value: '2M' },
      ]),
    )
    // Only what was saved has a row.
    expect(rows.map((row) => row.key)).not.toContain('perPlatformConcurrency')
  })

  it('store null as a value, and put it back', async () => {
    await updateSiteSettings({ downloadRateLimit: '1M' })
    await updateSiteSettings({ downloadRateLimit: null })
    expect((await getSiteSettings()).downloadRateLimit).toBeNull()
    const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, 'downloadRateLimit'))
    expect(row!.value).toBeNull()
  })

  it('use the default for a value of the wrong type, and ignore settings that no longer exist', async () => {
    await db.insert(siteSettings).values([
      { key: 'downloadConcurrency', value: 'lots' },
      { key: 'retiredSetting', value: true },
    ])
    await updateSiteSettings({}) // Clears the cache.
    const settings = await getSiteSettings()
    expect(settings.downloadConcurrency).toBe(defaultSiteSettings.downloadConcurrency)
    expect(settings).not.toHaveProperty('retiredSetting')
  })

  it("refuse to save a value of the wrong type", async () => {
    await expect(updateSiteSettings({ downloadConcurrency: 'lots' as unknown as number })).rejects.toThrow()
  })

  it("never show or save the app's own values, whose keys start with __", async () => {
    await db.insert(siteSettings).values({ key: '__visitorSalt', value: { day: '2026-10-12', salt: 'secret' } })
    await updateSiteSettings({ __visitorSalt: 'replaced' } as Partial<SiteSettings>)

    expect(Object.keys(await getSiteSettings()).some((key) => key.startsWith('__'))).toBe(false)
    const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, '__visitorSalt'))
    expect(row!.value).toEqual({ day: '2026-10-12', salt: 'secret' })
  })
})
