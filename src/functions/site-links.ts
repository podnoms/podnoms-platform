import { createServerFn } from '@tanstack/react-start'
import { env } from '~/env'

// Where to donate and the community Discord, for the top nav. Public, and read
// at runtime so one image serves any deployment.
export const fetchSiteLinks = createServerFn({ method: 'GET' }).handler(() => ({
  kofiUrl: env.KOFI_URL ?? null,
  bitcoinAddress: env.BITCOIN_ADDRESS ?? null,
  discordUrl: env.DISCORD_SERVER ?? null,
}))
