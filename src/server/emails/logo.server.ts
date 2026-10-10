// The site icon (public/logo.png), embedded in every email as an inline
// attachment rather than linked, so it shows without SITE_URL and in mail
// clients that block remote images. Scaled to twice the size it's shown at.
import '@tanstack/react-start/server-only'
import sharp from 'sharp'
import logoDataUri from '../../../public/logo.png?inline'

// What the layout's <img src="cid:…"> refers to.
export const logoCid = 'logo@podnoms'
export const logoSize = 36

let logo: Promise<Buffer> | undefined

export function emailLogo() {
  logo ??= sharp(Buffer.from(logoDataUri.split(',')[1]!, 'base64'))
    .resize(logoSize * 2, logoSize * 2)
    .png()
    .toBuffer()
  return logo
}
