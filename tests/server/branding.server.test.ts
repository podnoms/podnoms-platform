import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env } from '~/env'
import { defaultBranding, defaultLandingCopy } from '~/lib/branding'
import type { BrandingInput } from '~/lib/branding-schema'
import { themeCss } from '~/lib/theme-css'
import { themePresets } from '~/lib/theme-presets'
import { pickStyles } from '~/lib/theme-schema'
import {
  brandIcon,
  brandOgImage,
  getBranding,
  resetLogo,
  saveBranding,
  saveLogo,
  saveTheme,
  siteUserAgent,
} from '~/server/branding.server'
import { getSiteSettings, updateSiteSettings } from '~/server/site-settings.server'
import { UploadError } from '~/server/uploads.server'
import { prepareFonts } from '~/server/fonts.server'
import { makeImage, streamOf } from '../helpers'

// Saving a theme downloads its fonts from Google; fonts.server.test.ts tests that.
vi.mock('~/server/fonts.server', () => ({ prepareFonts: vi.fn(async () => {}) }))

const input: BrandingInput = {
  name: 'Pods',
  tagline: 'Shows for all',
  description: 'Shows from anything.',
  contactEmail: 'hi@pods.example',
  landing: null,
  privacyHtml: null,
  termsHtml: null,
  analyticsScriptUrl: null,
  analyticsAttributes: {},
}

// Settings outlive each test, so put the default branding back.
afterEach(async () => {
  await resetLogo()
  await saveTheme(null)
  await saveBranding({ ...defaultBranding, landing: null, analyticsScriptUrl: null, analyticsAttributes: {} })
})

describe('getBranding', () => {
  it('is the default branding until an admin saves their own', async () => {
    expect(await getBranding()).toEqual(defaultBranding)
  })

  it("gives the site's own name, copy, legal pages and analytics", async () => {
    await saveBranding({
      ...input,
      landing: { ...defaultLandingCopy, heroTitle: 'Make *shows*' },
      privacyHtml: '<h2>Data</h2><p>We keep <b>little</b>.</p>',
      analyticsScriptUrl: 'https://stats.example/script.js',
      analyticsAttributes: { 'data-website-id': 'abc' },
    })
    expect(await getBranding()).toEqual({
      ...defaultBranding,
      name: 'Pods',
      tagline: 'Shows for all',
      description: 'Shows from anything.',
      contactEmail: 'hi@pods.example',
      landing: { ...defaultLandingCopy, heroTitle: 'Make *shows*' },
      privacyHtml: '<h2>Data</h2><p>We keep <b>little</b>.</p>',
      analytics: { src: 'https://stats.example/script.js', attributes: { 'data-website-id': 'abc' } },
    })
  })
})

describe('saveBranding', () => {
  it('keeps only what differs from the default, so the rest follows it', async () => {
    await saveBranding({
      ...input,
      name: defaultBranding.name,
      landing: { ...defaultLandingCopy, ctaText: 'Go on.' },
    })
    const settings = await getSiteSettings()
    expect(settings.siteName).toBeNull()
    expect(settings.siteTagline).toBe('Shows for all')
    expect(settings.landingCopy).toEqual({ ctaText: 'Go on.' })
  })

  it('saves an unchanged landing page as the default', async () => {
    await saveBranding({ ...input, landing: defaultLandingCopy })
    expect((await getSiteSettings()).landingCopy).toBeNull()
  })

  it('sanitises the legal pages, and treats empty ones as unset', async () => {
    await saveBranding({ ...input, privacyHtml: '<h2 onclick="x()">Hi</h2><script>alert(1)</script>', termsHtml: '<p></p>' })
    const branding = await getBranding()
    expect(branding.privacyHtml).toBe('<h2>Hi</h2>')
    expect(branding.termsHtml).toBeNull()
  })

  it('drops the attributes along with the analytics address', async () => {
    await saveBranding({ ...input, analyticsScriptUrl: null, analyticsAttributes: { 'data-website-id': 'abc' } })
    expect((await getSiteSettings()).analyticsAttributes).toEqual({})
    expect((await getBranding()).analytics).toBeNull()
  })
})

describe('the logo', () => {
  it('starts as the bundled default, at every icon size', async () => {
    const { path, version } = await brandIcon(192)
    expect(version).toBe('default')
    expect(await sharp(path).metadata()).toMatchObject({ width: 192, height: 192, format: 'png' })
  })

  it('makes an uploaded image a square 512px PNG, keeping transparency', async () => {
    const { logoVersion } = await saveLogo(streamOf(await makeImage(800, 400, 'jpeg')))
    expect((await getBranding()).logoVersion).toBe(logoVersion)
    const { path, version } = await brandIcon(512)
    expect(version).toBe(logoVersion)
    expect(await sharp(path).metadata()).toMatchObject({ width: 512, height: 512, format: 'png', hasAlpha: true })
  })

  it('refuses a file that is not an image', async () => {
    await expect(saveLogo(streamOf('not an image'))).rejects.toBeInstanceOf(UploadError)
    expect((await getBranding()).logoVersion).toBeNull()
  })

  it('removes the old logo when replaced, and all but the default when reset', async () => {
    const dir = join(env.MEDIA_DIR, 'branding')
    const first = await saveLogo(streamOf(await makeImage(600, 600)))
    await brandIcon(32)
    const second = await saveLogo(streamOf(await makeImage(600, 600)))
    const names = await readdir(dir)
    expect(names.some((name) => name.includes(first.logoVersion))).toBe(false)
    expect(names).toContain(`logo-${second.logoVersion}.png`)

    await resetLogo()
    expect((await getBranding()).logoVersion).toBeNull()
    expect((await readdir(dir)).filter((name) => !name.startsWith('icon-default-'))).toEqual([])
  })

  it('falls back to the default when the uploaded file has gone', async () => {
    await updateSiteSettings({ logoVersion: 'missing' })
    expect((await brandIcon(32)).version).toBe('default')
    await updateSiteSettings({ logoVersion: null })
  })

  it('makes a 1200×630 card for link previews', async () => {
    const { path } = await brandOgImage()
    expect(await sharp(path).metadata()).toMatchObject({ width: 1200, height: 630, format: 'png' })
  })
})

describe('siteUserAgent', () => {
  it("names the site to other sites' APIs", async () => {
    await saveBranding(input)
    expect(await siteUserAgent()).toMatch(/^Pods \(\+https?:\/\//)
  })
})

describe('the theme', () => {
  const styles = {
    light: pickStyles(themePresets['modern-minimal']!.styles.light),
    dark: pickStyles(themePresets['modern-minimal']!.styles.dark),
  }

  it("is app.css's own until an admin saves one", async () => {
    expect((await getBranding()).theme).toBeNull()
    const edited = { ...styles, light: { ...styles.light, primary: 'oklch(0.6 0.2 25)' } }
    await saveTheme({ basedOn: 'modern-minimal', styles: edited })
    expect((await getBranding()).theme).toEqual({
      basedOn: 'modern-minimal',
      styles: edited,
      css: themeCss(edited),
      fonts: ['Inter', 'Source Serif 4', 'JetBrains Mono'],
    })
    // Its Google Fonts are downloaded first, ready for visitors.
    expect(prepareFonts).toHaveBeenCalledWith(['Inter', 'Source Serif 4', 'JetBrains Mono'])
    await saveTheme(null)
    expect((await getBranding()).theme).toBeNull()
  })

  it('keeps only the values the site uses', async () => {
    const withSpacing = { ...styles, light: { ...styles.light, spacing: '0.3rem' } as typeof styles.light }
    await saveTheme({ basedOn: null, styles: withSpacing })
    expect((await getBranding()).theme!.styles.light).not.toHaveProperty('spacing')
  })
})
