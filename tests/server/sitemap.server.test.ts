import { beforeEach, describe, expect, it } from 'vitest'
import { buildSitemap, listSitemapEntries } from '~/server/sitemap.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const published = { status: 'ready' as const, audioUrl: '/api/episodes/x/audio' }

const paths = async () => (await listSitemapEntries()).map((entry) => entry.path)

describe('listSitemapEntries', () => {
  it("lists the site's own pages", async () => {
    expect(await paths()).toEqual(['/', '/privacy', '/tos'])
  })

  it('lists listed podcasts and their published episodes', async () => {
    const podcast = await createPodcast((await createUser()).id, { slug: 'show', imageUrl: '/images/a.jpg' })
    await createEpisode(podcast.id, { ...published, slug: 'ep-1' })
    expect(await paths()).toEqual(['/', '/privacy', '/tos', '/podcasts/show', '/podcasts/show/episodes/ep-1'])
    const entries = await listSitemapEntries()
    expect(entries.find((entry) => entry.path === '/podcasts/show')?.image).toBe('/images/a.jpg')
  })

  it('leaves out private podcasts, empty podcasts and unpublished episodes', async () => {
    const userId = (await createUser()).id
    const secret = await createPodcast(userId, { slug: 'secret', private: true })
    await createEpisode(secret.id, { ...published, slug: 'hidden' })
    await createPodcast(userId, { slug: 'empty' })
    const show = await createPodcast(userId, { slug: 'show' })
    await createEpisode(show.id, { ...published, slug: 'ready' })
    await createEpisode(show.id, { slug: 'pending', status: 'pending' })
    await createEpisode(show.id, { slug: 'failed', status: 'failed' })
    expect(await paths()).toEqual(['/', '/privacy', '/tos', '/podcasts/show', '/podcasts/show/episodes/ready'])
  })

  it('dates entries by when episodes were published, falling back to when they were added', async () => {
    const show = await createPodcast((await createUser()).id, { slug: 'show' })
    await createEpisode(show.id, { ...published, slug: 'old', publishedAt: new Date('2025-01-01T00:00:00Z') })
    const recent = await createEpisode(show.id, { ...published, slug: 'recent', publishedAt: null })
    const entries = await listSitemapEntries()
    const lastModified = (path: string) => entries.find((entry) => entry.path === path)?.lastModified
    expect(lastModified('/podcasts/show/episodes/old')).toEqual(new Date('2025-01-01T00:00:00Z'))
    expect(lastModified('/podcasts/show/episodes/recent')).toEqual(recent.createdAt)
    expect(lastModified('/podcasts/show')).toEqual(recent.createdAt)
  })
})

describe('buildSitemap', () => {
  it('writes absolute, escaped URLs with dates and images', () => {
    const xml = buildSitemap(
      [
        { path: '/' },
        { path: '/podcasts/a&b', lastModified: new Date('2026-01-01T00:00:00Z'), image: '/images/a.jpg' },
      ],
      'https://pods.example',
    )
    expect(xml).toContain('<loc>https://pods.example/</loc>')
    expect(xml).toContain(
      '<url><loc>https://pods.example/podcasts/a&amp;b</loc><lastmod>2026-01-01T00:00:00.000Z</lastmod><image:image><image:loc>https://pods.example/images/a.jpg</image:loc></image:image></url>',
    )
  })
})
