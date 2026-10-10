import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { env } from '~/env'
import { publicUrl } from '~/server/site-url.server'

// Where to donate and the community Discord, for the top nav; the site's public
// origin, for absolute URLs in head tags; and search engines' verification
// tokens. Public, and read at runtime so one image serves any deployment.
export const fetchSiteLinks = createServerFn({ method: 'GET' }).handler(() => ({
  kofiUrl: env.KOFI_URL ?? null,
  bitcoinAddress: env.BITCOIN_ADDRESS ?? null,
  discordUrl: env.DISCORD_SERVER ?? null,
  origin: publicUrl(getRequest()).origin,
  googleSiteVerification: env.GOOGLE_SITE_VERIFICATION ?? null,
  bingSiteVerification: env.BING_SITE_VERIFICATION ?? null,
}))
