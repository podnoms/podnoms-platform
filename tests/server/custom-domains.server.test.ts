import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentDomainSlug } from '~/lib/current-domain'
import {
  catchDomainError,
  checkDomain,
  currentRequestDomainSlug,
  customDomainRecord,
  customDomainTarget,
  failureGraceMs,
  handleCustomDomain,
  isCustomHost,
  showForDomain,
  recheckCustomDomains,
  requestHost,
  setCustomDomain,
  setResolver,
  traefikConfig,
  verifyCustomDomain,
  type Resolver,
} from '~/server/custom-domains.server'
import { shows } from '~/server/db/schema'
import { feedPath, podcastGuid } from '~/server/feed.server'
import { createShow as createShowFor } from '~/server/shows.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'

vi.hoisted(() => {
  process.env.SITE_URL = 'https://podnoms.test'
  process.env.CUSTOM_DOMAIN_TARGET = 'domains.podnoms.test'
  process.env.CUSTOM_DOMAIN_IP = '203.0.113.7'
})

// DNS as the tests set it: records by name.
const dns = {
  cname: new Map<string, string[]>(),
  a: new Map<string, string[]>(),
  aaaa: new Map<string, string[]>(),
  txt: new Map<string, string[][]>(),
}
const notFound = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
const resolver: Resolver = {
  resolveCname: async (host) => dns.cname.get(host) ?? Promise.reject(notFound()),
  resolve4: async (host) => dns.a.get(host) ?? Promise.reject(notFound()),
  resolve6: async (host) => dns.aaaa.get(host) ?? Promise.reject(notFound()),
  resolveTxt: async (host) => dns.txt.get(host) ?? Promise.reject(notFound()),
}

function pointAtUs(domain: string, token: string) {
  dns.cname.set(domain, ['Domains.Podnoms.test.'])
  dns.txt.set(`_podnoms.${domain}`, [['podnoms-verify=', token]])
}

beforeEach(async () => {
  await resetDb(db)
  dns.cname.clear()
  dns.a.clear()
  dns.aaaa.clear()
  dns.txt.clear()
  setResolver(resolver)
})
afterEach(() => setResolver(null))

async function showRow(id: string) {
  const [row] = await db.select().from(shows).where(eq(shows.id, id))
  return row!
}

// A show with the domain set, and its records as they should be.
async function showWithDomain(domain = 'pod.example.com', values: Parameters<typeof createShow>[1] = {}) {
  const user = await createUser()
  const show = await createShow(user.id, values)
  await setCustomDomain(user.id, show.id, domain)
  const row = await showRow(show.id)
  pointAtUs(domain, row.customDomainToken!)
  return { user, show: row }
}

describe('hosts', () => {
  it("are the site's own, or possibly a custom domain", () => {
    expect(customDomainTarget()).toBe('domains.podnoms.test')
    expect(isCustomHost('podnoms.test')).toBe(false)
    expect(isCustomHost('localhost')).toBe(false)
    expect(isCustomHost('127.0.0.1')).toBe(false)
    expect(isCustomHost('[::1]')).toBe(false)
    expect(isCustomHost('pod.example.com')).toBe(true)
  })

  it('come from the forwarded host, without the port', () => {
    const request = new Request('http://app:3000/', { headers: { host: 'app:3000', 'x-forwarded-host': 'Pod.Example.com:443' } })
    expect(requestHost(request)).toBe('pod.example.com')
    expect(requestHost(new Request('http://app:3000/', { headers: { host: 'pod.example.com' } }))).toBe('pod.example.com')
  })
})

describe('checkDomain', () => {
  it('passes when the CNAME and TXT records are right', async () => {
    pointAtUs('pod.example.com', 'tok')
    expect(await checkDomain('pod.example.com', 'tok')).toEqual({ pointer: { ok: true }, txt: { ok: true } })
  })

  it('says what is wrong with each record', async () => {
    dns.cname.set('pod.example.com', ['elsewhere.example.net'])
    dns.txt.set('_podnoms.pod.example.com', [['podnoms-verify=old']])
    expect(await checkDomain('pod.example.com', 'tok')).toEqual({
      pointer: { ok: false, reason: 'pod.example.com points to elsewhere.example.net, not domains.podnoms.test' },
      txt: { ok: false, reason: "The TXT record for _podnoms.pod.example.com isn't podnoms-verify=tok" },
    })
  })

  it('says when the records are missing', async () => {
    const check = await checkDomain('pod.example.com', 'tok')
    expect(check.pointer).toEqual({ ok: false, reason: "There's no CNAME record for pod.example.com yet" })
    expect(check.txt).toEqual({ ok: false, reason: "There's no TXT record for _podnoms.pod.example.com yet" })
  })

  it('checks each record on its own', async () => {
    dns.txt.set('_podnoms.pod.example.com', [['podnoms-verify=tok']])
    const check = await checkDomain('pod.example.com', 'tok')
    expect(check.pointer.ok).toBe(false)
    expect(check.txt.ok).toBe(true)
  })

  it("passes a domain's root with an A record at our address", async () => {
    dns.a.set('example.com', ['203.0.113.7'])
    expect((await checkDomain('example.com', 'tok')).pointer).toEqual({ ok: true })
  })

  it('asks for an A record on a root, and a CNAME on a subdomain', async () => {
    expect((await checkDomain('example.com', 'tok')).pointer).toEqual({
      ok: false,
      reason: "There's no A record for example.com yet",
    })
    expect((await checkDomain('pod.example.com', 'tok')).pointer).toEqual({
      ok: false,
      reason: "There's no CNAME record for pod.example.com yet",
    })
  })

  it('refuses a root with any other address', async () => {
    dns.a.set('example.com', ['203.0.113.7', '198.51.100.1'])
    expect((await checkDomain('example.com', 'tok')).pointer).toEqual({
      ok: false,
      reason: 'example.com points to 198.51.100.1, not 203.0.113.7',
    })
    dns.a.set('example.com', ['203.0.113.7'])
    dns.aaaa.set('example.com', ['2001:db8::1'])
    expect((await checkDomain('example.com', 'tok')).pointer).toEqual({
      ok: false,
      reason: 'example.com also has an AAAA record (2001:db8::1); remove it',
    })
  })
})

describe('customDomainRecord', () => {
  it("is an A record on a domain's root, wherever the suffix", () => {
    const a = { type: 'A', value: '203.0.113.7' }
    expect(customDomainRecord('example.com')).toEqual(a)
    expect(customDomainRecord('ferg.al')).toEqual(a)
    expect(customDomainRecord('example.co.uk')).toEqual(a)
  })

  it('is a CNAME on a subdomain, or before a domain is chosen', () => {
    const cname = { type: 'CNAME', value: 'domains.podnoms.test' }
    expect(customDomainRecord('pod.example.com')).toEqual(cname)
    expect(customDomainRecord('pod.example.co.uk')).toEqual(cname)
    expect(customDomainRecord(null)).toEqual(cname)
  })
})

describe('setCustomDomain', () => {
  it('sets the domain with a token, unverified', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    expect(await setCustomDomain(user.id, show.id, 'pod.example.com')).toBe(true)
    const row = await showRow(show.id)
    expect(row.customDomain).toBe('pod.example.com')
    expect(row.customDomainToken).toMatch(/^[0-9a-f]{32}$/)
    expect(row.customDomainVerifiedAt).toBeNull()
  })

  it('keeps the token when the same domain is saved again', async () => {
    const { user, show } = await showWithDomain()
    await setCustomDomain(user.id, show.id, 'pod.example.com')
    expect((await showRow(show.id)).customDomainToken).toBe(show.customDomainToken)
  })

  it('makes a new token and unverifies when the domain changes', async () => {
    const { user, show } = await showWithDomain()
    await verifyCustomDomain(user.id, show.id)
    await setCustomDomain(user.id, show.id, 'other.example.com')
    const row = await showRow(show.id)
    expect(row.customDomainToken).not.toBe(show.customDomainToken)
    expect(row.customDomainVerifiedAt).toBeNull()
    expect(await showForDomain('pod.example.com')).toBeNull()
  })

  it('removes the domain', async () => {
    const { user, show } = await showWithDomain()
    await setCustomDomain(user.id, show.id, null)
    const row = await showRow(show.id)
    expect(row.customDomain).toBeNull()
    expect(row.customDomainToken).toBeNull()
  })

  it("refuses a domain another show uses", async () => {
    await showWithDomain()
    const user = await createUser()
    const show = await createShow(user.id)
    expect(await catchDomainError(() => setCustomDomain(user.id, show.id, 'pod.example.com'))).toEqual({
      error: 'That domain is already used by another show',
    })
  })

  it("refuses the site's own domains", async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    for (const domain of ['podnoms.test', 'x.podnoms.test', 'domains.podnoms.test']) {
      expect(await catchDomainError(() => setCustomDomain(user.id, show.id, domain))).toHaveProperty('error')
    }
  })

  it("doesn't touch other users' shows", async () => {
    const show = await createShow((await createUser()).id)
    expect(await setCustomDomain((await createUser()).id, show.id, 'pod.example.com')).toBe(false)
    expect((await showRow(show.id)).customDomain).toBeNull()
  })

  it('can be set when the show is created', async () => {
    const user = await createUser()
    const created = await createShowFor(user.id, { title: 'Show', customDomain: 'pod.example.com' })
    const row = await showRow(created.id)
    expect(row.customDomain).toBe('pod.example.com')
    expect(row.customDomainToken).toBeTruthy()
    expect(await catchDomainError(() => createShowFor(user.id, { title: 'Again', customDomain: 'pod.example.com' }))).toEqual({
      error: 'That domain is already used by another show',
    })
  })
})

describe('verifyCustomDomain', () => {
  it('verifies the domain when both records are right', async () => {
    const { user, show } = await showWithDomain('pod.example.com', { slug: 'show' })
    expect(await showForDomain('pod.example.com')).toBeNull()
    const result = await verifyCustomDomain(user.id, show.id)
    expect(result?.verifiedAt).toBeInstanceOf(Date)
    expect(await showForDomain('pod.example.com')).toBe('show')
  })

  it("doesn't verify it with only the CNAME", async () => {
    const { user, show } = await showWithDomain()
    dns.txt.clear()
    const result = await verifyCustomDomain(user.id, show.id)
    expect(result?.pointer.ok).toBe(true)
    expect(result?.txt.ok).toBe(false)
    expect(result?.verifiedAt).toBeNull()
    expect((await showRow(show.id)).customDomainVerifiedAt).toBeNull()
  })

  it('is null for a show without a domain', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    expect(await verifyCustomDomain(user.id, show.id)).toBeNull()
  })
})

describe('recheckCustomDomains', () => {
  it('drops a domain only after its records have been wrong for the grace period', async () => {
    const { user, show } = await showWithDomain('pod.example.com', { slug: 'show' })
    await verifyCustomDomain(user.id, show.id)
    dns.cname.clear()
    const start = new Date()
    expect(await recheckCustomDomains(start)).toEqual({ checked: 1, failing: 1, dropped: 0 })
    expect((await showRow(show.id)).customDomainFailingSince).toEqual(start)

    const almost = new Date(start.getTime() + failureGraceMs - 60 * 60 * 1000)
    expect(await recheckCustomDomains(almost)).toEqual({ checked: 1, failing: 1, dropped: 0 })
    expect(await showForDomain('pod.example.com')).toBe('show')

    expect(await recheckCustomDomains(new Date(start.getTime() + failureGraceMs))).toEqual({ checked: 1, failing: 0, dropped: 1 })
    expect((await showRow(show.id)).customDomainVerifiedAt).toBeNull()
    expect(await showForDomain('pod.example.com')).toBeNull()
  })

  it('forgets a failure once the records are back', async () => {
    const { user, show } = await showWithDomain()
    await verifyCustomDomain(user.id, show.id)
    const records = dns.cname.get('pod.example.com')!
    dns.cname.clear()
    await recheckCustomDomains()
    dns.cname.set('pod.example.com', records)
    await recheckCustomDomains()
    const row = await showRow(show.id)
    expect(row.customDomainFailingSince).toBeNull()
    expect(row.customDomainVerifiedAt).not.toBeNull()
  })
})

describe('handleCustomDomain', () => {
  const next = vi.fn(async () => ({ slug: currentRequestDomainSlug(), routerSlug: currentDomainSlug() }))
  const visit = (url: string) => handleCustomDomain(new Request(url), next)

  beforeEach(() => next.mockClear())

  async function verifiedShow() {
    const { user, show } = await showWithDomain('pod.example.com', { slug: 'show', title: 'The Show' })
    await verifyCustomDomain(user.id, show.id)
    return show
  }

  it("leaves the site's own requests alone", async () => {
    expect(await visit('https://podnoms.test/settings')).toEqual({ slug: null, routerSlug: null })
  })

  it("serves the show's pages, telling the router which show", async () => {
    await verifiedShow()
    for (const path of ['/', '/episodes/ep-1', '/_serverFn/x', '/api/episodes/1/audio']) {
      expect(await visit(`https://pod.example.com${path}`)).toEqual({ slug: 'show', routerSlug: 'show' })
    }
  })

  it("redirects a verified domain's root to its www, keeping the path", async () => {
    const { user, show } = await showWithDomain('www.example.com', { slug: 'show', title: 'The Show' })
    await verifyCustomDomain(user.id, show.id)
    for (const path of ['/', '/episodes/ep-1?t=1', '/s/abc']) {
      const response = (await visit(`https://example.com${path}`)) as Response
      expect(response.status).toBe(301)
      expect(response.headers.get('location')).toBe(`https://www.example.com${path}`)
    }
    expect(next).not.toHaveBeenCalled()
  })

  it("redirects a verified root's www to it", async () => {
    const { user, show } = await showWithDomain('example.co.uk', { slug: 'show', title: 'The Show' })
    await verifyCustomDomain(user.id, show.id)
    const response = (await visit('https://www.example.co.uk/')) as Response
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://example.co.uk/')
  })

  it("doesn't redirect to a domain that isn't verified, or from other subdomains", async () => {
    await showWithDomain('www.unverified.com')
    const unverified = (await visit('https://unverified.com/')) as Response
    expect(unverified.headers.get('location')).toBe('https://podnoms.test/')
    await verifiedShow()
    const subdomain = (await visit('https://www.pod.example.com/')) as Response
    expect(subdomain.headers.get('location')).toBe('https://podnoms.test/')
  })

  it('sends anything else to the site', async () => {
    await verifiedShow()
    const response = (await visit('https://pod.example.com/settings?tab=1')) as Response
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://podnoms.test/settings?tab=1')
    expect(next).not.toHaveBeenCalled()
  })

  it("sends a domain that isn't verified to the site", async () => {
    await showWithDomain()
    const response = (await visit('https://pod.example.com/')) as Response
    expect(response.headers.get('location')).toBe('https://podnoms.test/')
  })

  it("lets the edge's own requests through by internal name", async () => {
    expect(await visit('http://app:3000/api/domains/allowed?domain=x')).toEqual({ slug: null, routerSlug: null })
  })

  it('serves the feed with links on the domain, keeping its guid', async () => {
    const show = await verifiedShow()
    await createEpisode(show.id, {
      slug: 'ep-1',
      status: 'ready',
      audioUrl: '/api/episodes/x/audio',
      audioSizeBytes: 1,
      audioMimeType: 'audio/mpeg',
    })
    const response = (await visit('https://pod.example.com/feed')) as Response
    expect(response.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8')
    const xml = await response.text()
    expect(xml).toContain('<atom:link href="https://pod.example.com/feed"')
    expect(xml).toContain('<link>https://pod.example.com/episodes/ep-1</link>')
    expect(xml).toContain('url="https://pod.example.com/api/episodes/x/audio"')
    expect(xml).toContain(`<podcast:guid>${podcastGuid(`https://podnoms.test${feedPath('show')}`)}</podcast:guid>`)
  })
})

describe('traefikConfig', () => {
  it('is empty without an edge container', async () => {
    await showWithDomain()
    expect(await traefikConfig()).toEqual({})
  })
})
