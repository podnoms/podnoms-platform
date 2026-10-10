// Podcasts served from their owners' own domains.
//
// An owner sets a domain on the podcast's Distribution tab and adds two DNS
// records: a CNAME pointing it at us (customDomainTarget), and a TXT record
// holding a token we made, which proves they control the domain (so nobody
// can claim a domain that someone else pointed at us). Once both check out,
// the domain is verified: it's served (see src/start.ts and src/router.tsx),
// and the edge container may get a certificate for it (/api/domains/allowed),
// with Traefik passing its connections through (/api/traefik/config). A daily
// job checks verified domains again and drops those whose records have gone.
import '@tanstack/react-start/server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, timingSafeEqual } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { and, eq, isNotNull } from 'drizzle-orm'
import { env } from '~/env'
import { domainFeedPath, isSharedPath, normalizeDomain, toSitePath, txtRecordName, txtRecordValue } from '~/lib/custom-domain'
import { db } from '~/server/db/client.server'
import { podcasts } from '~/server/db/schema'
import { ExpiringStore } from '~/server/expiring-store.server'
import { logger } from '~/server/logger.server'
import { siteOrigin } from '~/server/site-url.server'

// How long a verified domain's records may stay broken before it's dropped.
export const failureGraceMs = 72 * 60 * 60 * 1000

// The site's own host name, or null without SITE_URL. Custom domains need it:
// without it there's no telling the site's own address from someone else's.
function siteHost() {
  const origin = siteOrigin()
  return origin ? new URL(origin).hostname : null
}

// Where owners point their CNAME, or null when custom domains are off.
export function customDomainTarget() {
  const site = siteHost()
  if (!site) return null
  return (env.CUSTOM_DOMAIN_TARGET && normalizeDomain(env.CUSTOM_DOMAIN_TARGET)) || site
}

// The host the visitor asked for, as passed on by the proxies in front of us.
export function requestHost(request: Request) {
  const header = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host
  const host = header.split(',')[0]!.trim().toLowerCase()
  // Without the port; IPv6 literals keep their brackets.
  return host.replace(/:\d+$/, '').replace(/\.$/, '')
}

// Whether a host might be someone's custom domain rather than the site itself.
export function isCustomHost(host: string) {
  const site = siteHost()
  if (!site || !host) return false
  if (host === site || host === 'localhost' || host.endsWith('.localhost')) return false
  return !isIP(host.replace(/^\[|\]$/g, ''))
}

// The site's own host, and anything under it, can't be claimed.
function isSiteDomain(domain: string) {
  const site = siteHost()
  const target = customDomainTarget()
  return [site, target].some((own) => own && (domain === own || domain.endsWith(`.${own}`)))
}

export type RecordCheck = { ok: true } | { ok: false; reason: string }
export type DomainCheck = { cname: RecordCheck; txt: RecordCheck }

export type Resolver = {
  resolveCname: (host: string) => Promise<string[]>
  resolveTxt: (host: string) => Promise<string[][]>
}

let resolver: Resolver = dns

// For tests, which can't rely on real DNS.
export function setResolver(next: Resolver | null) {
  resolver = next ?? dns
}

const bare = (host: string) => host.toLowerCase().replace(/\.$/, '')

function lookupFailure(error: unknown, record: string, name: string) {
  const code = (error as { code?: string }).code
  if (code === 'ENOTFOUND' || code === 'ENODATA') return `There's no ${record} record for ${name} yet`
  if (code === 'ETIMEOUT' || code === 'ECONNREFUSED' || code === 'ESERVFAIL') {
    return `Looking up ${name} failed; try again in a minute`
  }
  return `Couldn't look up the ${record} record for ${name}`
}

// Whether the domain's DNS records are as the owner was asked to set them.
export async function checkDomain(domain: string, token: string): Promise<DomainCheck> {
  const target = customDomainTarget()
  const txtName = txtRecordName(domain)
  const expected = txtRecordValue(token)
  const [cname, txt] = await Promise.all([
    resolver.resolveCname(domain).then(
      (names): RecordCheck => {
        if (!target) return { ok: false, reason: 'Custom domains are not set up on this site' }
        if (names.some((name) => bare(name) === target)) return { ok: true }
        if (!names.length) return { ok: false, reason: `There's no CNAME record for ${domain} yet` }
        return { ok: false, reason: `${domain} points to ${bare(names[0]!)}, not ${target}` }
      },
      (error): RecordCheck => ({ ok: false, reason: lookupFailure(error, 'CNAME', domain) }),
    ),
    resolver.resolveTxt(txtName).then(
      (records): RecordCheck => {
        // Long TXT records come in chunks.
        if (records.some((chunks) => chunks.join('').trim() === expected)) return { ok: true }
        if (!records.length) return { ok: false, reason: `There's no TXT record for ${txtName} yet` }
        return { ok: false, reason: `The TXT record for ${txtName} isn't ${expected}` }
      },
      (error): RecordCheck => ({ ok: false, reason: lookupFailure(error, 'TXT', txtName) }),
    ),
  ])
  return { cname, txt }
}

const passes = (check: DomainCheck) => check.cname.ok && check.txt.ok

// Which podcast each custom domain shows, looked up on every request to one.
const domainSlugs = new ExpiringStore<{ slug: string | null }>(60_000)

function forget(...domains: (string | null | undefined)[]) {
  for (const domain of domains) if (domain) domainSlugs.delete(domain)
}

// The slug of the podcast verified for this domain, or null.
export async function podcastForDomain(host: string) {
  const cached = domainSlugs.get(host)
  if (cached) return cached.slug
  const [podcast] = await db
    .select({ slug: podcasts.slug })
    .from(podcasts)
    .where(and(eq(podcasts.customDomain, host), isNotNull(podcasts.customDomainVerifiedAt)))
    .limit(1)
  const slug = podcast?.slug ?? null
  domainSlugs.set(host, { slug })
  return slug
}

// Every verified domain, for the edge's configuration.
export async function verifiedDomains() {
  return db
    .select({ podcastId: podcasts.id, domain: podcasts.customDomain })
    .from(podcasts)
    .where(and(isNotNull(podcasts.customDomain), isNotNull(podcasts.customDomainVerifiedAt)))
    .orderBy(podcasts.customDomain)
    .then((rows) => rows.map((row) => ({ podcastId: row.podcastId, domain: row.domain! })))
}

function isDomainConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  // Drizzle wraps the database's error in its own.
  if ('cause' in error && isDomainConflict(error.cause)) return true
  const { code, constraint_name } = error as { code?: string; constraint_name?: string }
  return code === '23505' && constraint_name === 'podcast_customDomain_unique'
}

export class CustomDomainError extends Error {
  override name = 'CustomDomainError'
}

// Runs something that may refuse a domain, returning the refusal for the form
// to show rather than throwing it.
export async function catchDomainError<T>(run: () => Promise<T>): Promise<{ value: T } | { error: string }> {
  try {
    return { value: await run() }
  } catch (error) {
    if (error instanceof CustomDomainError) return { error: error.message }
    throw error
  }
}

const newToken = () => crypto.randomUUID().replaceAll('-', '')

// The columns to set for a podcast's domain: a fresh token and no verification,
// unless the domain hasn't changed.
export function customDomainValues(domain: string | null) {
  if (domain && isSiteDomain(domain)) throw new CustomDomainError("That's this site's own domain; use one of yours")
  return {
    customDomain: domain,
    customDomainToken: domain ? newToken() : null,
    customDomainVerifiedAt: null,
    customDomainFailingSince: null,
  }
}

// Turns the database's complaint about a domain in use into one for the owner.
export async function withDomainConflict<T>(run: () => Promise<T>) {
  try {
    return await run()
  } catch (error) {
    if (isDomainConflict(error)) throw new CustomDomainError('That domain is already used by another podcast')
    throw error
  }
}

// Sets (or, with null, removes) a podcast's domain. Returns false unless the
// podcast belongs to the user.
export async function setCustomDomain(userId: string, podcastId: string, domain: string | null) {
  const [podcast] = await db
    .select({ customDomain: podcasts.customDomain })
    .from(podcasts)
    .where(and(eq(podcasts.id, podcastId), eq(podcasts.userId, userId)))
    .limit(1)
  if (!podcast) return false
  // Saving the same domain again keeps its token, so the owner's TXT record stays right.
  if (podcast.customDomain === domain) return true
  const values = customDomainValues(domain)
  await withDomainConflict(() => db.update(podcasts).set(values).where(eq(podcasts.id, podcastId)))
  forget(podcast.customDomain, domain)
  return true
}

// Checks a podcast's domain's records now, marking it verified if they're
// right and unverified if not. Null unless the podcast is the user's and has a domain.
export async function verifyCustomDomain(userId: string, podcastId: string) {
  const [podcast] = await db
    .select({ domain: podcasts.customDomain, token: podcasts.customDomainToken })
    .from(podcasts)
    .where(and(eq(podcasts.id, podcastId), eq(podcasts.userId, userId)))
    .limit(1)
  if (!podcast?.domain || !podcast.token) return null
  const check = await checkDomain(podcast.domain, podcast.token)
  const verifiedAt = passes(check) ? new Date() : null
  await db
    .update(podcasts)
    .set({ customDomainVerifiedAt: verifiedAt, customDomainFailingSince: null })
    .where(eq(podcasts.id, podcastId))
  forget(podcast.domain)
  return { ...check, verifiedAt }
}

// The daily check of verified domains. A domain whose records have been wrong
// for longer than the grace period stops being served (and so stops getting
// certificates); a passing check clears an earlier failure.
export async function recheckCustomDomains(now = new Date()) {
  const rows = await db
    .select({
      id: podcasts.id,
      domain: podcasts.customDomain,
      token: podcasts.customDomainToken,
      failingSince: podcasts.customDomainFailingSince,
    })
    .from(podcasts)
    .where(and(isNotNull(podcasts.customDomain), isNotNull(podcasts.customDomainVerifiedAt)))
  let failing = 0
  let dropped = 0
  for (const row of rows) {
    const check = await checkDomain(row.domain!, row.token ?? '')
    if (passes(check)) {
      if (row.failingSince) {
        await db.update(podcasts).set({ customDomainFailingSince: null }).where(eq(podcasts.id, row.id))
      }
      continue
    }
    const since = row.failingSince ?? now
    if (now.getTime() - since.getTime() >= failureGraceMs) {
      await db
        .update(podcasts)
        .set({ customDomainVerifiedAt: null, customDomainFailingSince: null })
        .where(eq(podcasts.id, row.id))
      forget(row.domain)
      logger.warn({ podcastId: row.id, domain: row.domain, check }, 'Custom domain dropped: its DNS records are gone')
      dropped++
    } else {
      if (!row.failingSince) {
        await db.update(podcasts).set({ customDomainFailingSince: now }).where(eq(podcasts.id, row.id))
      }
      failing++
    }
  }
  return { checked: rows.length, failing, dropped }
}

// Which podcast's domain the current request is on, for the router (see
// src/lib/current-domain.ts) and the public server functions.
const state = globalThis as { podnomsCustomDomain?: AsyncLocalStorage<string> }
const requestDomain = (state.podnomsCustomDomain ??= new AsyncLocalStorage<string>())

export function currentRequestDomainSlug() {
  return requestDomain.getStore() ?? null
}

// Request handling for custom domains, from the middleware in src/start.ts.
// The site itself is left alone. On a podcast's verified domain, its pages
// (and what they load) are served with the podcast recorded for the router;
// its feed is served here; anything else is sent to the site, where sign-in
// works. Domains we don't know of are sent to the site too.
export async function handleCustomDomain<T>(request: Request, next: () => T | Promise<T>): Promise<T | Response> {
  const host = requestHost(request)
  if (!isCustomHost(host)) return next()
  const url = new URL(request.url)
  const { pathname } = url
  const slug = await podcastForDomain(host)
  // The edge's own endpoints are reached by internal names (http://app:3000).
  if (!slug) return isSharedPath(pathname) ? next() : toSite(url)
  if (pathname === domainFeedPath) {
    // Imported here, as the feed needs podcasts.server.ts, which needs this.
    const { buildPodcastFeed } = await import('~/server/feed.server')
    const xml = await buildPodcastFeed(slug, siteOrigin()!, { domain: host })
    if (!xml) return new Response('Not found', { status: 404 })
    return new Response(xml, {
      headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    })
  }
  if (isSharedPath(pathname) || toSitePath(pathname, slug)) return requestDomain.run(slug, next)
  return toSite(url)
}

function toSite(url: URL) {
  const target = new URL(url.pathname + url.search, siteOrigin()!)
  return new Response(null, { status: 302, headers: { Location: target.toString() } })
}

// Dynamic configuration for Traefik's HTTP provider. Traefik doesn't terminate
// TLS for custom domains: for each verified one it passes connections through
// (by SNI) to the edge container, which has the certificates. Plain HTTP goes
// there too, to be redirected to HTTPS. Each domain has its own routers, so
// one with broken DNS doesn't hold up the rest. Empty without an edge.
export async function traefikConfig() {
  const edge = env.CUSTOM_DOMAIN_EDGE_HOST
  if (!edge || !customDomainTarget()) return {}
  const domains = await verifiedDomains()
  if (!domains.length) return {}
  const tlsService = 'podnoms-edge-tls'
  const httpService = 'podnoms-edge-http'
  const name = (podcastId: string) => `podnoms-domain-${podcastId}`
  return {
    tcp: {
      routers: Object.fromEntries(
        domains.map(({ podcastId, domain }) => [
          name(podcastId),
          {
            rule: `HostSNI(\`${domain}\`)`,
            entryPoints: [env.TRAEFIK_TLS_ENTRYPOINT],
            service: tlsService,
            tls: { passthrough: true },
          },
        ]),
      ),
      services: {
        // PROXY protocol, so the edge (and our activity stats) see the listener's address.
        [tlsService]: { loadBalancer: { servers: [{ address: `${edge}:443` }], proxyProtocol: { version: 2 } } },
      },
    },
    http: {
      routers: Object.fromEntries(
        domains.map(({ podcastId, domain }) => [
          name(podcastId),
          { rule: `Host(\`${domain}\`)`, entryPoints: [env.TRAEFIK_HTTP_ENTRYPOINT], service: httpService },
        ]),
      ),
      services: {
        [httpService]: { loadBalancer: { servers: [{ url: `http://${edge}:80` }] } },
      },
    },
  }
}

// Whether a request may read the Traefik configuration.
export function traefikAuthorized(request: Request) {
  const token = env.TRAEFIK_CONFIG_TOKEN
  if (!token) return true
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${token}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// For the configuration's ETag.
export function configHash(body: string) {
  return createHash('sha1').update(body).digest('hex')
}
