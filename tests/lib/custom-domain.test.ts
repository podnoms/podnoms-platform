import { describe, expect, it } from 'vitest'
import { isSharedPath, normalizeDomain, toDomainPath, toSitePath, txtRecordName, txtRecordValue } from '~/lib/custom-domain'

const show = { ownerSlug: 'ada', slug: 'show' }

describe('custom domain paths', () => {
  it("map the domain's pages to the show's routes", () => {
    expect(toSitePath('/', show)).toBe('/ada/show')
    expect(toSitePath('/episodes/ep-1', show)).toBe('/ada/show/ep-1')
    expect(toSitePath('/episodes/ep-1/', show)).toBe('/ada/show/ep-1')
    expect(toSitePath('/live', show)).toBe('/ada/show/live')
    expect(toSitePath('/feed', show)).toBe('/ada/show/feed')
  })

  it("leave paths the domain has no page for alone", () => {
    for (const path of ['/settings', '/show', '/ada/show', '/episodes', '/episodes/a/b']) {
      expect(toSitePath(path, show)).toBeNull()
    }
  })

  it("map the show's routes back to the domain's short paths", () => {
    expect(toDomainPath('/ada/show', show)).toBe('/')
    expect(toDomainPath('/ada/show/', show)).toBe('/')
    expect(toDomainPath('/ada/show/ep-1', show)).toBe('/episodes/ep-1')
    expect(toDomainPath('/ada/show/feed', show)).toBe('/feed')
    expect(toDomainPath('/ada/show/live', show)).toBe('/live')
  })

  it("leave other shows' and the app's paths alone", () => {
    for (const path of [
      '/ada',
      '/ada/other',
      '/bob/show',
      '/ada/showy/x',
      '/ada/show/manage',
      '/ada/show/ep-1/manage',
      '/ada/other/live',
      '/ada/other/feed',
      '/show/ep-1',
      '/',
    ]) {
      expect(toDomainPath(path, show)).toBeNull()
    }
  })

  it('are reversible', () => {
    for (const path of ['/', '/episodes/ep-1', '/live', '/feed']) {
      expect(toDomainPath(toSitePath(path, show)!, show)).toBe(path)
    }
  })

  it('share what the pages load, as it is', () => {
    for (const path of ['/_serverFn/abc', '/api/episodes/1/audio', '/images/x.jpg', '/assets/app.js', '/embed/a/b', '/robots.txt', '/favicon-32x32.png']) {
      expect(isSharedPath(path)).toBe(true)
    }
    for (const path of ['/', '/settings', '/show', '/feed']) expect(isSharedPath(path)).toBe(false)
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
  expect(txtRecordName('pod.example.com', 'podnoms')).toBe('_podnoms.pod.example.com')
  expect(txtRecordValue('abc', 'podnoms')).toBe('podnoms-verify=abc')
})
