import { describe, expect, it } from 'vitest'
import { isSharedPath, normalizeDomain, toDomainPath, toSitePath, txtRecordName, txtRecordValue } from '~/lib/custom-domain'

describe('custom domain paths', () => {
  it("map the domain's pages to the podcast's routes", () => {
    expect(toSitePath('/', 'show')).toBe('/podcasts/show')
    expect(toSitePath('/episodes/ep-1', 'show')).toBe('/podcasts/show/episodes/ep-1')
    expect(toSitePath('/episodes/ep-1/', 'show')).toBe('/podcasts/show/episodes/ep-1')
  })

  it("leave paths the domain has no page for alone", () => {
    for (const path of ['/settings', '/podcasts/show', '/episodes', '/episodes/a/b', '/feed']) {
      expect(toSitePath(path, 'show')).toBeNull()
    }
  })

  it("map the podcast's routes back to the domain's short paths", () => {
    expect(toDomainPath('/podcasts/show', 'show')).toBe('/')
    expect(toDomainPath('/podcasts/show/', 'show')).toBe('/')
    expect(toDomainPath('/podcasts/show/episodes/ep-1', 'show')).toBe('/episodes/ep-1')
    expect(toDomainPath('/feed/show', 'show')).toBe('/feed')
  })

  it("leave other podcasts' and the app's paths alone", () => {
    for (const path of ['/podcasts/other', '/podcasts/show/manage', '/podcasts/showy/episodes/x', '/feed/other', '/']) {
      expect(toDomainPath(path, 'show')).toBeNull()
    }
  })

  it('are reversible', () => {
    for (const path of ['/', '/episodes/ep-1']) {
      expect(toDomainPath(toSitePath(path, 'show')!, 'show')).toBe(path)
    }
  })

  it('share what the pages load, as it is', () => {
    for (const path of ['/_serverFn/abc', '/api/episodes/1/audio', '/images/x.jpg', '/assets/app.js', '/embed/a/b', '/robots.txt', '/favicon-32x32.png']) {
      expect(isSharedPath(path)).toBe(true)
    }
    for (const path of ['/', '/settings', '/podcasts/show', '/feed']) expect(isSharedPath(path)).toBe(false)
  })
})

describe('normalizeDomain', () => {
  it('takes the host name from what was typed or pasted', () => {
    expect(normalizeDomain('  Pod.Example.COM ')).toBe('pod.example.com')
    expect(normalizeDomain('https://pod.example.com/feed?x=1')).toBe('pod.example.com')
    expect(normalizeDomain('pod.example.com.')).toBe('pod.example.com')
    expect(normalizeDomain('pod.example.com:443')).toBe('pod.example.com')
  })

  it("rejects what isn't a host name", () => {
    for (const input of ['', 'localhost', 'pod', 'pod..example.com', '-pod.example.com', 'pod_x.example.com', '10.0.0.1', 'pod example.com']) {
      expect(normalizeDomain(input)).toBeNull()
    }
  })
})

it('names the TXT record that proves ownership', () => {
  expect(txtRecordName('pod.example.com')).toBe('_podnoms.pod.example.com')
  expect(txtRecordValue('abc')).toBe('podnoms-verify=abc')
})
