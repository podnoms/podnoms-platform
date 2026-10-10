import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllEnvs())

// Loads the module afresh with the given environment, as src/env.ts reads it once.
async function load(vars: Record<string, string> = {}) {
  vi.resetModules()
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value)
  return import('~/server/site-url.server')
}

const request = new Request('http://internal:3000/feed/x?y=1')

describe('the site URL', () => {
  it("is the request's own when nothing is configured", async () => {
    const { publicUrl, siteOrigin } = await load()
    expect(siteOrigin()).toBeNull()
    expect(publicUrl(request).toString()).toBe('http://internal:3000/feed/x?y=1')
  })

  it("takes SITE_URL's protocol, host and port", async () => {
    const { publicUrl, siteOrigin } = await load({ SITE_URL: 'https://podnoms.example' })
    expect(siteOrigin()).toBe('https://podnoms.example')
    expect(publicUrl(request).toString()).toBe('https://podnoms.example/feed/x?y=1')
  })

  it('keeps only the origin of a URL with a path', async () => {
    const { siteOrigin } = await load({ SITE_URL: 'https://podnoms.example:8443/some/path' })
    expect(siteOrigin()).toBe('https://podnoms.example:8443')
  })
})
