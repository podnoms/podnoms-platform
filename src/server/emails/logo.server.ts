// The site's logo (see branding.server.ts), embedded in every email as an
// inline attachment rather than linked, so it shows without SITE_URL and in
// mail clients that block remote images. Scaled to twice the size it's shown at.
import '@tanstack/react-start/server-only'
import sharp from 'sharp'
import { currentLogo } from '~/server/branding.server'

// What the layout's <img src="cid:…"> refers to.
export const logoCid = 'logo@site'
export const logoSize = 36

let logo: { version: string; image: Promise<Buffer> } | undefined

export async function emailLogo() {
  const { version, image } = await currentLogo()
  if (logo?.version !== version) {
    logo = { version, image: sharp(image).resize(logoSize * 2, logoSize * 2).png().toBuffer() }
  }
  return logo.image
}
