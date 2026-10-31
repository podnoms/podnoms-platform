import { beforeEach, describe, expect, it } from 'vitest'
import { buildSitemap, listSitemapEntries } from '~/server/sitemap.server'
import { resetDb } from '../db'
import { episodeTags, showTags, tags } from '~/server/db/schema'
import { createEpisode, createShow, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

const published = { status: 'ready' as const, audioUrl: '/api/episodes/x/audio' }

const paths = async () => (await listSitemapEntries()).map((entry) => entry.path)

describe('listSitemapEntries', () => {
  it("lists the site's own pages", async () => {
    expect(await paths()).toEqual(['/', '/explore', '/privacy', '/tos'])
  })

  it('lists listed shows and their published episodes', async () => {
    const show = await createShow((await createUser()).id, { slug: 'show', imageUrl: '/images/a.jpg' })
    await createEpisode(show.id, { ...published, slug: 'ep-1' })
    expect(await paths()).toEqual(['/', '/explore', '/privacy', '/tos', '/show', '/show/ep-1'])
    const entries = await listSitemapEntries()
    expect(entries.find((entry) => entry.path === '/show')?.image).toBe('/images/a.jpg')
  })

  it('leaves out private shows, empty shows and unpublished episodes', async () => {
    const userId = (await createUser()).id
    const secret = await createShow(userId, { slug: 'secret', private: true })
    await createEpisode(secret.id, { ...published, slug: 'hidden' })
    await createShow(userId, { slug: 'empty' })
    const show = await createShow(userId, { slug: 'show' })
    await createEpisode(show.id, { ...published, slug: 'ready' })
    await createEpisode(show.id, { slug: 'pending', status: 'pending' })
    await createEpisode(show.id, { slug: 'failed', status: 'failed' })
    expect(await paths()).toEqual(['/', '/explore', '/privacy', '/tos', '/show', '/show/ready'])
  })

  it('lists the tags of listed episodes and shows, once each', async () => {
    const userId = (await createUser()).id
    await db.insert(tags).values([
      { id: 'house', name: 'house', slug: 'house' },
      { id: 'dub', name: 'dub', slug: 'dub' },
      { id: 'secret', name: 'secret', slug: 'secret' },
      { id: 'unused', name: 'unused', slug: 'unused' },
    ])
    const show = await createShow(userId, { slug: 'show' })
    const episode = await createEpisode(show.id, { ...published, slug: 'ep' })
    const hidden = await createShow(userId, { slug: 'hidden', private: true })
    await createEpisode(hidden.id, { ...published, slug: 'ep' })
    await db.insert(showTags).values([
      { showId: show.id, tagId: 'dub' },
      { showId: hidden.id, tagId: 'secret' },
    ])
    await db.insert(episodeTags).values([
      { episodeId: episode.id, tagId: 'house' },
      { episodeId: episode.id, tagId: 'dub' },
    ])
    expect((await paths()).filter((path) => path.startsWith('/tags/'))).toEqual(['/tags/dub', '/tags/house'])
  })

  it('dates entries by when episodes were published, falling back to when they were added', async () => {
    const show = await createShow((await createUser()).id, { slug: 'show' })
    await createEpisode(show.id, { ...published, slug: 'old', publishedAt: new Date('2025-01-01T00:00:00Z') })
    const recent = await createEpisode(show.id, { ...published, slug: 'recent', publishedAt: null })
    const entries = await listSitemapEntries()
    const lastModified = (path: string) => entries.find((entry) => entry.path === path)?.lastModified
    expect(lastModified('/show/old')).toEqual(new Date('2025-01-01T00:00:00Z'))
    expect(lastModified('/show/recent')).toEqual(recent.createdAt)
    expect(lastModified('/show')).toEqual(recent.createdAt)
  })
})

describe('buildSitemap', () => {
  it('writes absolute, escaped URLs with dates and images', () => {
    const xml = buildSitemap(
      [
        { path: '/' },
        { path: '/a&b', lastModified: new Date('2026-01-01T00:00:00Z'), image: '/images/a.jpg' },
      ],
      'https://pods.example',
    )
    expect(xml).toContain('<loc>https://pods.example/</loc>')
    expect(xml).toContain(
      '<url><loc>https://pods.example/a&amp;b</loc><lastmod>2026-01-01T00:00:00.000Z</lastmod><image:image><image:loc>https://pods.example/images/a.jpg</image:loc></image:image></url>',
    )
  })
})
