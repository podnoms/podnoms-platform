import { describe, expect, it } from 'vitest'
import { siteSettingsSchema } from '~/lib/site-settings-schema'

const form = { downloadConcurrency: '3', perPlatformConcurrency: '2', downloadDelaySeconds: '10', channelCheckHours: '6', downloadRateLimit: '' }

describe('siteSettingsSchema', () => {
  it('takes the form as numbers, with a blank speed limit as none', () => {
    expect(siteSettingsSchema.parse(form)).toEqual({
      downloadConcurrency: 3,
      perPlatformConcurrency: 2,
      downloadDelaySeconds: 10,
      channelCheckHours: 6,
      downloadRateLimit: null,
    })
  })

  it.each([
    [{ downloadConcurrency: '0' }, /at least 1/],
    [{ downloadConcurrency: '2', perPlatformConcurrency: '3' }, /per platform/],
    [{ downloadDelaySeconds: '1.5' }, /whole number/],
    [{ downloadRateLimit: 'fast' }, /500K/],
  ])('rejects %o', (change, message) => {
    const result = siteSettingsSchema.safeParse({ ...form, ...change })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0]!.message).toMatch(message)
  })

  it('accepts speed limits yt-dlp understands', () => {
    for (const limit of ['500K', '2M', '1.5M', '100000']) {
      expect(siteSettingsSchema.parse({ ...form, downloadRateLimit: limit }).downloadRateLimit).toBe(limit)
    }
  })
})
