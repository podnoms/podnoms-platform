// A podcast served from its owner's own domain (see custom-domains.server.ts).
// On such a domain the podcast's pages have short paths: "/" for the podcast,
// "/episodes/<slug>" for an episode and "/feed" for its RSS feed. The router
// maps them to the usual routes and back (see src/router.tsx), so the pages
// and their links work unchanged.
import { episodePath, podcastPath } from '~/lib/paths'

export const domainFeedPath = '/feed'

// Paths a custom domain serves as they are: server functions, audio, images,
// embeds and the like, which the podcast's pages load or link to.
const sharedPrefixes = ['/_serverFn/', '/api/', '/images/', '/assets/', '/embed/', '/listen/', '/s/', '/@', '/node_modules/', '/src/']

export function isSharedPath(pathname: string) {
  // Files at the root, such as robots.txt and the icons.
  if (/^\/[^/]+\.\w+$/.test(pathname)) return true
  return sharedPrefixes.some((prefix) => pathname.startsWith(prefix))
}

const episodeOnDomain = /^\/episodes\/([^/]+)\/?$/

// The address bar's path on the podcast's domain → the site's path, or null
// if the domain has no page there.
export function toSitePath(pathname: string, slug: string) {
  if (pathname === '/') return podcastPath(slug)
  const episode = episodeOnDomain.exec(pathname)
  return episode ? episodePath(slug, episode[1]!) : null
}

// The site's path → the address bar's path on the podcast's domain, or null
// for pages that aren't the podcast's own.
export function toDomainPath(pathname: string, slug: string) {
  const podcast = podcastPath(slug)
  if (pathname === podcast || pathname === `${podcast}/`) return '/'
  if (pathname === `/feed/${slug}`) return domainFeedPath
  const episode = new RegExp(`^${podcast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/episodes/([^/]+)/?$`).exec(pathname)
  return episode ? `/episodes/${episode[1]}` : null
}

// A domain as typed or pasted ("https://Pod.Example.com/feed") → "pod.example.com",
// or null if it isn't a plausible host name.
export function normalizeDomain(input: string) {
  let host = input.trim().toLowerCase()
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  host = host.split(/[/?#]/, 1)[0]!.replace(/:\d+$/, '').replace(/\.$/, '')
  const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
  const labels = host.split('.')
  if (host.length > 253 || labels.length < 2 || !labels.every((part) => label.test(part))) return null
  // Not an IP address.
  if (labels.every((part) => /^\d+$/.test(part))) return null
  return host
}

// The TXT record that proves the owner controls the domain.
export function txtRecordName(domain: string) {
  return `_podnoms.${domain}`
}

export function txtRecordValue(token: string) {
  return `podnoms-verify=${token}`
}
