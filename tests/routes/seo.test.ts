// robots.txt and sitemap.xml, which search engines fetch.
import { beforeEach, describe, expect, it } from 'vitest'
import { Route as RobotsRoute } from '~/routes/robots[.]txt'
import { Route as SitemapRoute } from '~/routes/sitemap[.]xml'
import { resetDb } from '../db'
import { callRoute, createEpisode, createPodcast, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

describe('GET /robots.txt', () => {
  it('keeps crawlers out of the app and points them to the sitemap', async () => {
    const response = await callRoute(RobotsRoute, 'GET', new Request('https://pods.example/robots.txt'))
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const text = await response.text()
    expect(text).toContain('Disallow: /api/')
    expect(text).toContain('Allow: /api/episodes/*/audio')
    expect(text).toContain('Sitemap: https://pods.example/sitemap.xml')
  })
})

describe('GET /sitemap.xml', () => {
  it('lists published episodes at absolute URLs', async () => {
    const podcast = await createPodcast((await createUser()).id, { slug: 'show' })
    await createEpisode(podcast.id, { slug: 'ep-1', status: 'ready', audioUrl: '/api/episodes/x/audio' })
    const response = await callRoute(SitemapRoute, 'GET', new Request('https://pods.example/sitemap.xml'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    const xml = await response.text()
    expect(xml).toContain('<loc>https://pods.example/podcasts/show/episodes/ep-1</loc>')
  })
})
