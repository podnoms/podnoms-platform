import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { env } from '~/env'
import { publicUrl } from '~/server/site-url.server'

// Donation, community and mobile app links; the site's public
// origin, for absolute URLs in head tags; and search engines' verification
// tokens. Public, and read at runtime so one image serves any deployment.
export const fetchSiteLinks = createServerFn({ method: 'GET' }).handler(() => ({
  kofiUrl: env.KOFI_URL ?? null,
  bitcoinAddress: env.BITCOIN_ADDRESS ?? null,
  discordUrl: env.DISCORD_SERVER ?? null,
  mobileAppUrl: env.MOBILE_APP_URL ?? null,
  origin: publicUrl(getRequest()).origin,
  googleSiteVerification: env.GOOGLE_SITE_VERIFICATION ?? null,
  bingSiteVerification: env.BING_SITE_VERIFICATION ?? null,
}))
