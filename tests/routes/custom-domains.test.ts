// The endpoints the custom-domain edge relies on: Caddy's "ask" before it gets
// a certificate, and the routers Traefik polls for.
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as AllowedRoute } from '~/routes/api/domains/allowed'
import { Route as TraefikRoute } from '~/routes/api/traefik/config'
import { setCustomDomain, setResolver, verifyCustomDomain } from '~/server/custom-domains.server'
import { podcasts } from '~/server/db/schema'
import { resetDb } from '../db'
import { callRoute, createPodcast, createUser, db } from '../helpers'

vi.hoisted(() => {
  process.env.SITE_URL = 'https://podnoms.test'
  process.env.CUSTOM_DOMAIN_EDGE_HOST = 'podnoms-edge'
  process.env.TRAEFIK_CONFIG_TOKEN = 'secret'
})

beforeEach(() => resetDb(db))

// A podcast with the domain set, verified or not.
async function withDomain(domain: string, verified: boolean) {
  const user = await createUser()
  const podcast = await createPodcast(user.id)
  await setCustomDomain(user.id, podcast.id, domain)
  const [row] = await db.select().from(podcasts).where(eq(podcasts.id, podcast.id))
  setResolver({
    resolveCname: async () => (verified ? ['podnoms.test'] : []),
    resolveTxt: async () => [[`podnoms-verify=${row!.customDomainToken}`]],
  })
  await verifyCustomDomain(user.id, podcast.id)
  setResolver(null)
  return podcast
}

const ask = (domain: string) =>
  callRoute(AllowedRoute, 'GET', new Request(`http://app:3000/api/domains/allowed?domain=${encodeURIComponent(domain)}`))

describe('GET /api/domains/allowed', () => {
  it('allows a certificate only for a verified domain', async () => {
    await withDomain('pod.example.com', true)
    await withDomain('unverified.example.com', false)
    expect((await ask('pod.example.com')).status).toBe(200)
    expect((await ask('POD.example.com')).status).toBe(200)
    expect((await ask('unverified.example.com')).status).toBe(404)
    expect((await ask('unknown.example.com')).status).toBe(404)
    expect((await ask('')).status).toBe(404)
  })
})

const config = (headers: Record<string, string> = { authorization: 'Bearer secret' }) =>
  callRoute(TraefikRoute, 'GET', new Request('http://app:3000/api/traefik/config', { headers }))

describe('GET /api/traefik/config', () => {
  it('needs the token', async () => {
    expect((await config({})).status).toBe(401)
    expect((await config({ authorization: 'Bearer wrong!' })).status).toBe(401)
  })

  it('passes verified domains through to the edge, each with its own routers', async () => {
    const podcast = await withDomain('pod.example.com', true)
    await withDomain('unverified.example.com', false)
    const response = await config()
    expect(response.status).toBe(200)
    const body = await response.json()
    const name = `podnoms-domain-${podcast.id}`
    expect(Object.keys(body.tcp.routers)).toEqual([name])
    expect(body.tcp.routers[name]).toEqual({
      rule: 'HostSNI(`pod.example.com`)',
      entryPoints: ['websecure'],
      service: 'podnoms-edge-tls',
      tls: { passthrough: true },
    })
    expect(body.tcp.services['podnoms-edge-tls']).toEqual({
      loadBalancer: { servers: [{ address: 'podnoms-edge:443' }], proxyProtocol: { version: 2 } },
    })
    expect(body.http.routers[name]).toEqual({
      rule: 'Host(`pod.example.com`)',
      entryPoints: ['web'],
      service: 'podnoms-edge-http',
    })
    expect(body.http.services['podnoms-edge-http']).toEqual({
      loadBalancer: { servers: [{ url: 'http://podnoms-edge:80' }] },
    })
  })

  it('is empty with no verified domains', async () => {
    expect(await (await config()).json()).toEqual({})
  })

  it('answers 304 when nothing changed', async () => {
    await withDomain('pod.example.com', true)
    const etag = (await config()).headers.get('etag')!
    expect((await config({ authorization: 'Bearer secret', 'if-none-match': etag })).status).toBe(304)
  })
})
