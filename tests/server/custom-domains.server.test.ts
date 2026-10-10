import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentDomainSlug } from '~/lib/current-domain'
import {
  catchDomainError,
  checkDomain,
  currentRequestDomainSlug,
  customDomainTarget,
  failureGraceMs,
  handleCustomDomain,
  isCustomHost,
  podcastForDomain,
  recheckCustomDomains,
  requestHost,
  setCustomDomain,
  setResolver,
  traefikConfig,
  verifyCustomDomain,
  type Resolver,
} from '~/server/custom-domains.server'
import { podcasts } from '~/server/db/schema'
import { feedPath, podcastGuid } from '~/server/feed.server'
import { createPodcast as createPodcastFor } from '~/server/podcasts.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

vi.hoisted(() => {
  process.env.SITE_URL = 'https://podnoms.test'
  process.env.CUSTOM_DOMAIN_TARGET = 'domains.podnoms.test'
})

// DNS as the tests set it: CNAME and TXT records by name.
const dns = { cname: new Map<string, string[]>(), txt: new Map<string, string[][]>() }
const notFound = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
const resolver: Resolver = {
  resolveCname: async (host) => dns.cname.get(host) ?? Promise.reject(notFound()),
  resolveTxt: async (host) => dns.txt.get(host) ?? Promise.reject(notFound()),
}

function pointAtUs(domain: string, token: string) {
  dns.cname.set(domain, ['Domains.Podnoms.test.'])
  dns.txt.set(`_podnoms.${domain}`, [['podnoms-verify=', token]])
}

beforeEach(async () => {
  await resetDb(db)
  dns.cname.clear()
  dns.txt.clear()
  setResolver(resolver)
})
afterEach(() => setResolver(null))

async function podcastRow(id: string) {
  const [row] = await db.select().from(podcasts).where(eq(podcasts.id, id))
  return row!
}

// A podcast with the domain set, and its records as they should be.
async function podcastWithDomain(domain = 'pod.example.com', values: Parameters<typeof createPodcast>[1] = {}) {
  const user = await createUser()
  const podcast = await createPodcast(user.id, values)
  await setCustomDomain(user.id, podcast.id, domain)
  const row = await podcastRow(podcast.id)
  pointAtUs(domain, row.customDomainToken!)
  return { user, podcast: row }
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
    expect(await checkDomain('pod.example.com', 'tok')).toEqual({ cname: { ok: true }, txt: { ok: true } })
  })

  it('says what is wrong with each record', async () => {
    dns.cname.set('pod.example.com', ['elsewhere.example.net'])
    dns.txt.set('_podnoms.pod.example.com', [['podnoms-verify=old']])
    expect(await checkDomain('pod.example.com', 'tok')).toEqual({
      cname: { ok: false, reason: 'pod.example.com points to elsewhere.example.net, not domains.podnoms.test' },
      txt: { ok: false, reason: "The TXT record for _podnoms.pod.example.com isn't podnoms-verify=tok" },
    })
  })

  it('says when the records are missing', async () => {
    const check = await checkDomain('pod.example.com', 'tok')
    expect(check.cname).toEqual({ ok: false, reason: "There's no CNAME record for pod.example.com yet" })
    expect(check.txt).toEqual({ ok: false, reason: "There's no TXT record for _podnoms.pod.example.com yet" })
  })

  it('checks each record on its own', async () => {
    dns.txt.set('_podnoms.pod.example.com', [['podnoms-verify=tok']])
    const check = await checkDomain('pod.example.com', 'tok')
    expect(check.cname.ok).toBe(false)
    expect(check.txt.ok).toBe(true)
  })
})

describe('setCustomDomain', () => {
  it('sets the domain with a token, unverified', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id)
    expect(await setCustomDomain(user.id, podcast.id, 'pod.example.com')).toBe(true)
    const row = await podcastRow(podcast.id)
    expect(row.customDomain).toBe('pod.example.com')
    expect(row.customDomainToken).toMatch(/^[0-9a-f]{32}$/)
    expect(row.customDomainVerifiedAt).toBeNull()
  })

  it('keeps the token when the same domain is saved again', async () => {
    const { user, podcast } = await podcastWithDomain()
    await setCustomDomain(user.id, podcast.id, 'pod.example.com')
    expect((await podcastRow(podcast.id)).customDomainToken).toBe(podcast.customDomainToken)
  })

  it('makes a new token and unverifies when the domain changes', async () => {
    const { user, podcast } = await podcastWithDomain()
    await verifyCustomDomain(user.id, podcast.id)
    await setCustomDomain(user.id, podcast.id, 'other.example.com')
    const row = await podcastRow(podcast.id)
    expect(row.customDomainToken).not.toBe(podcast.customDomainToken)
    expect(row.customDomainVerifiedAt).toBeNull()
    expect(await podcastForDomain('pod.example.com')).toBeNull()
  })

  it('removes the domain', async () => {
    const { user, podcast } = await podcastWithDomain()
    await setCustomDomain(user.id, podcast.id, null)
    const row = await podcastRow(podcast.id)
    expect(row.customDomain).toBeNull()
    expect(row.customDomainToken).toBeNull()
  })

  it("refuses a domain another podcast uses", async () => {
    await podcastWithDomain()
    const user = await createUser()
    const podcast = await createPodcast(user.id)
    expect(await catchDomainError(() => setCustomDomain(user.id, podcast.id, 'pod.example.com'))).toEqual({
      error: 'That domain is already used by another podcast',
    })
  })

  it("refuses the site's own domains", async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id)
    for (const domain of ['podnoms.test', 'x.podnoms.test', 'domains.podnoms.test']) {
      expect(await catchDomainError(() => setCustomDomain(user.id, podcast.id, domain))).toHaveProperty('error')
    }
  })

  it("doesn't touch other users' podcasts", async () => {
    const podcast = await createPodcast((await createUser()).id)
    expect(await setCustomDomain((await createUser()).id, podcast.id, 'pod.example.com')).toBe(false)
    expect((await podcastRow(podcast.id)).customDomain).toBeNull()
  })

  it('can be set when the podcast is created', async () => {
    const user = await createUser()
    const created = await createPodcastFor(user.id, { title: 'Show', customDomain: 'pod.example.com' })
    const row = await podcastRow(created.id)
    expect(row.customDomain).toBe('pod.example.com')
    expect(row.customDomainToken).toBeTruthy()
    expect(await catchDomainError(() => createPodcastFor(user.id, { title: 'Again', customDomain: 'pod.example.com' }))).toEqual({
      error: 'That domain is already used by another podcast',
    })
  })
})

describe('verifyCustomDomain', () => {
  it('verifies the domain when both records are right', async () => {
    const { user, podcast } = await podcastWithDomain('pod.example.com', { slug: 'show' })
    expect(await podcastForDomain('pod.example.com')).toBeNull()
    const result = await verifyCustomDomain(user.id, podcast.id)
    expect(result?.verifiedAt).toBeInstanceOf(Date)
    expect(await podcastForDomain('pod.example.com')).toBe('show')
  })

  it("doesn't verify it with only the CNAME", async () => {
    const { user, podcast } = await podcastWithDomain()
    dns.txt.clear()
    const result = await verifyCustomDomain(user.id, podcast.id)
    expect(result?.cname.ok).toBe(true)
    expect(result?.txt.ok).toBe(false)
    expect(result?.verifiedAt).toBeNull()
    expect((await podcastRow(podcast.id)).customDomainVerifiedAt).toBeNull()
  })

  it('is null for a podcast without a domain', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id)
    expect(await verifyCustomDomain(user.id, podcast.id)).toBeNull()
  })
})

describe('recheckCustomDomains', () => {
  it('drops a domain only after its records have been wrong for the grace period', async () => {
    const { user, podcast } = await podcastWithDomain('pod.example.com', { slug: 'show' })
    await verifyCustomDomain(user.id, podcast.id)
    dns.cname.clear()
    const start = new Date()
    expect(await recheckCustomDomains(start)).toEqual({ checked: 1, failing: 1, dropped: 0 })
    expect((await podcastRow(podcast.id)).customDomainFailingSince).toEqual(start)

    const almost = new Date(start.getTime() + failureGraceMs - 60 * 60 * 1000)
    expect(await recheckCustomDomains(almost)).toEqual({ checked: 1, failing: 1, dropped: 0 })
    expect(await podcastForDomain('pod.example.com')).toBe('show')

    expect(await recheckCustomDomains(new Date(start.getTime() + failureGraceMs))).toEqual({ checked: 1, failing: 0, dropped: 1 })
    expect((await podcastRow(podcast.id)).customDomainVerifiedAt).toBeNull()
    expect(await podcastForDomain('pod.example.com')).toBeNull()
  })

  it('forgets a failure once the records are back', async () => {
    const { user, podcast } = await podcastWithDomain()
    await verifyCustomDomain(user.id, podcast.id)
    const records = dns.cname.get('pod.example.com')!
    dns.cname.clear()
    await recheckCustomDomains()
    dns.cname.set('pod.example.com', records)
    await recheckCustomDomains()
    const row = await podcastRow(podcast.id)
    expect(row.customDomainFailingSince).toBeNull()
    expect(row.customDomainVerifiedAt).not.toBeNull()
  })
})

describe('handleCustomDomain', () => {
  const next = vi.fn(async () => ({ slug: currentRequestDomainSlug(), routerSlug: currentDomainSlug() }))
  const visit = (url: string) => handleCustomDomain(new Request(url), next)

  beforeEach(() => next.mockClear())

  async function verifiedShow() {
    const { user, podcast } = await podcastWithDomain('pod.example.com', { slug: 'show', title: 'The Show' })
    await verifyCustomDomain(user.id, podcast.id)
    return podcast
  }

  it("leaves the site's own requests alone", async () => {
    expect(await visit('https://podnoms.test/settings')).toEqual({ slug: null, routerSlug: null })
  })

  it("serves the podcast's pages, telling the router which podcast", async () => {
    await verifiedShow()
    for (const path of ['/', '/episodes/ep-1', '/_serverFn/x', '/api/episodes/1/audio']) {
      expect(await visit(`https://pod.example.com${path}`)).toEqual({ slug: 'show', routerSlug: 'show' })
    }
  })

  it('sends anything else to the site', async () => {
    await verifiedShow()
    const response = (await visit('https://pod.example.com/settings?tab=1')) as Response
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://podnoms.test/settings?tab=1')
    expect(next).not.toHaveBeenCalled()
  })

  it("sends a domain that isn't verified to the site", async () => {
    await podcastWithDomain()
    const response = (await visit('https://pod.example.com/')) as Response
    expect(response.headers.get('location')).toBe('https://podnoms.test/')
  })

  it("lets the edge's own requests through by internal name", async () => {
    expect(await visit('http://app:3000/api/domains/allowed?domain=x')).toEqual({ slug: null, routerSlug: null })
  })

  it('serves the feed with links on the domain, keeping its guid', async () => {
    const podcast = await verifiedShow()
    await createEpisode(podcast.id, {
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
    await podcastWithDomain()
    expect(await traefikConfig()).toEqual({})
  })
})
