// The site's branding (see src/lib/branding.ts), kept in site_settings over
// the defaults, and its logo, kept in MEDIA_DIR/branding with the icons made
// from it.
import '@tanstack/react-start/server-only'
import { existsSync } from 'node:fs'
import { readdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { defaultBranding, defaultLandingCopy, type Branding, type BrandIconSize, type LandingCopy } from '~/lib/branding'
import type { BrandingInput } from '~/lib/branding-schema'
import { themeCss } from '~/lib/theme-css'
import { googleFontsIn } from '~/lib/theme-fonts'
import { pickStyles, type SiteTheme } from '~/lib/theme-schema'
import { prepareFonts } from '~/server/fonts.server'
import { sanitizePage } from '~/server/rich-text.server'
import { maxImageBytes } from '~/server/images.server'
import { getSiteSettings, updateSiteSettings } from '~/server/site-settings.server'
import { siteOrigin } from '~/server/site-url.server'
import { brandIconPath, brandLogoPath, ensureBrandingDir } from '~/server/storage.server'
import { receiveFile, UploadError } from '~/server/uploads.server'
import defaultLogoDataUri from '../assets/default-logo.png?inline'

export async function getBranding(): Promise<Branding> {
  const settings = await getSiteSettings()
  return {
    name: settings.siteName ?? defaultBranding.name,
    tagline: settings.siteTagline ?? defaultBranding.tagline,
    description: settings.siteDescription ?? defaultBranding.description,
    contactEmail: settings.contactEmail ?? defaultBranding.contactEmail,
    logoVersion: settings.logoVersion,
    landing: { ...defaultLandingCopy, ...settings.landingCopy },
    privacyHtml: sanitizePage(settings.privacyHtml),
    termsHtml: sanitizePage(settings.termsHtml),
    analytics: settings.analyticsScriptUrl ? { src: settings.analyticsScriptUrl, attributes: settings.analyticsAttributes } : null,
    theme: settings.siteTheme && {
      ...settings.siteTheme,
      css: themeCss(settings.siteTheme.styles),
      fonts: googleFontsIn({ ...settings.siteTheme.styles.dark, ...settings.siteTheme.styles.light }),
    },
  }
}

// Makes the theme the site's; null goes back to app.css's own. Only the values
// the site uses are kept. Its Google Fonts are downloaded first, so they're
// ready for the first visitor (a font that can't be is tried again then).
export async function saveTheme(theme: SiteTheme | null) {
  if (theme) await prepareFonts(googleFontsIn({ ...theme.styles.dark, ...theme.styles.light }))
  await updateSiteSettings({
    siteTheme: theme && {
      basedOn: theme.basedOn,
      styles: { light: pickStyles(theme.styles.light), dark: pickStyles(theme.styles.dark) },
    },
  })
}

// A value the same as its default is saved as null, so it follows the default.
const unlessDefault = <T>(value: T, fallback: T) => (value === fallback ? null : value)

// Only the parts of the landing page's copy that differ from the default.
function landingOverrides(copy: LandingCopy | null) {
  if (!copy) return null
  const changed = Object.fromEntries(
    Object.entries(copy).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(defaultLandingCopy[key as keyof LandingCopy])),
  )
  return Object.keys(changed).length > 0 ? changed : null
}

export async function saveBranding(input: BrandingInput) {
  await updateSiteSettings({
    siteName: unlessDefault(input.name, defaultBranding.name),
    siteTagline: unlessDefault(input.tagline, defaultBranding.tagline),
    siteDescription: unlessDefault(input.description, defaultBranding.description),
    contactEmail: unlessDefault(input.contactEmail, defaultBranding.contactEmail),
    landingCopy: landingOverrides(input.landing),
    privacyHtml: sanitizePage(input.privacyHtml),
    termsHtml: sanitizePage(input.termsHtml),
    analyticsScriptUrl: input.analyticsScriptUrl,
    analyticsAttributes: input.analyticsScriptUrl ? input.analyticsAttributes : {},
  })
}

export const logoSide = 512

// Makes the uploaded image the site's logo: square (transparent around a
// logo that isn't), 512px, PNG. Throws an UploadError if it isn't an image.
export async function saveLogo(body: ReadableStream<Uint8Array>) {
  const dir = await ensureBrandingDir()
  const version = crypto.randomUUID().slice(0, 8)
  const original = join(dir, `upload-${version}`)
  try {
    await receiveFile(body, original, maxImageBytes)
    await sharp(original)
      .resize(logoSide, logoSide, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(brandLogoPath(version))
      .catch(() => {
        throw new UploadError("That file isn't an image we can read", 415)
      })
  } finally {
    await rm(original, { force: true })
  }
  await updateSiteSettings({ logoVersion: version })
  await removeOldLogos(version)
  return { logoVersion: version }
}

// Goes back to the default logo.
export async function resetLogo() {
  await updateSiteSettings({ logoVersion: null })
  await removeOldLogos(null)
}

// Removes the files of every logo but `keep` (and the default's icons).
async function removeOldLogos(keep: string | null) {
  const dir = await ensureBrandingDir()
  const kept = keep ? [`logo-${keep}.png`, `icon-${keep}-`] : []
  for (const name of await readdir(dir)) {
    if (name.startsWith('icon-default-') || kept.some((prefix) => name.startsWith(prefix))) continue
    await rm(join(dir, name), { force: true })
  }
}

// The current logo: its version ("default" for the bundled one) and the image.
export async function currentLogo(): Promise<{ version: string; image: string | Buffer }> {
  const { logoVersion } = await getSiteSettings()
  // An uploaded logo whose file has gone (say MEDIA_DIR was replaced) gives way to the default.
  if (logoVersion && existsSync(brandLogoPath(logoVersion))) return { version: logoVersion, image: brandLogoPath(logoVersion) }
  return { version: 'default', image: Buffer.from(defaultLogoDataUri.split(',')[1]!, 'base64') }
}

// The logo at one of brandIconSizes, made on first request and kept.
export async function brandIcon(size: BrandIconSize) {
  const { version, image } = await currentLogo()
  const path = brandIconPath(version, size)
  if (!existsSync(path)) {
    await ensureBrandingDir()
    // Written aside then moved, so a request meanwhile never reads half a file.
    const partial = `${path}.${crypto.randomUUID()}.partial`
    await sharp(image).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(partial)
    await rename(partial, path)
  }
  return { path, version }
}

// The card for link previews of pages without their own image: the logo,
// centred on white at 1200×630. Made on first request and kept.
export async function brandOgImage() {
  const { version, image } = await currentLogo()
  const path = brandIconPath(version, 'og')
  if (!existsSync(path)) {
    await ensureBrandingDir()
    const logo = await sharp(image).resize(360, 360, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    const partial = `${path}.${crypto.randomUUID()}.partial`
    await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#ffffff' } })
      .composite([{ input: logo, gravity: 'centre' }])
      .png()
      .toFile(partial)
    await rename(partial, path)
  }
  return { path, version }
}

// The icon as a response: cached for good when asked for with the current
// logo's ?v=, otherwise briefly, so a new logo shows soon.
export async function brandIconResponse(request: Request, size: BrandIconSize | 'og') {
  const { path, version } = size === 'og' ? await brandOgImage() : await brandIcon(size)
  const current = new URL(request.url).searchParams.get('v') === version
  return new Response(new Uint8Array(await readFile(path)), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': current ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    },
  })
}

// How the site introduces itself to other sites' APIs: its name and address.
export async function siteUserAgent() {
  return `${(await getBranding()).name} (+${siteOrigin() ?? 'https://github.com/podnoms/podnoms-platform'})`
}
