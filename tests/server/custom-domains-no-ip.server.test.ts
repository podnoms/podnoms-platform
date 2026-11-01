import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkDomain, customDomainRecord, setResolver } from '~/server/custom-domains.server'

// Without CUSTOM_DOMAIN_IP, a domain's root can't be used.
vi.hoisted(() => {
  process.env.SITE_URL = 'https://podnoms.test'
  delete process.env.CUSTOM_DOMAIN_IP
})

afterEach(() => setResolver(null))

describe('without an address for roots', () => {
  it('asks for a CNAME, even on a root', () => {
    expect(customDomainRecord('example.com')).toEqual({ type: 'CNAME', value: 'podnoms.test' })
  })

  it('ignores A records', async () => {
    setResolver({
      resolveCname: async () => [],
      resolve4: async () => ['203.0.113.7'],
      resolve6: async () => [],
      resolveTxt: async () => [],
    })
    expect((await checkDomain('example.com', 'tok')).pointer).toEqual({
      ok: false,
      reason: "There's no CNAME record for example.com yet",
    })
  })
})
