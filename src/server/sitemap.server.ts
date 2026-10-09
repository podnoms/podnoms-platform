// The sitemap search engines are pointed to from robots.txt: the site's own
// pages, and every listed podcast with published episodes, and those episodes.
import '@tanstack/react-start/server-only'
import { and, desc, eq, max, sql } from 'drizzle-orm'
import { episodePath, podcastPath } from '~/lib/paths'
import { db } from '~/server/db/client.server'
import { episodes, podcasts } from '~/server/db/schema'
import { escapeXml } from '~/server/feed.server'
import { isPublished, newestPublishedFirst } from '~/server/episodes.server'

export type SitemapEntry = { path: string; lastModified?: Date; image?: string }

// A sitemap holds at most 50,000 URLs. Past that, this needs to become a
// sitemap index pointing at several sitemaps; until then, the newest win.
const maxEntries = 50_000

const sitePages = ['/', '/privacy', '/tos']

const publishedAt = sql<Date>`coalesce(${episodes.publishedAt}, ${episodes.createdAt})`.mapWith(episodes.createdAt)

// Private podcasts are unlisted, so they and their episodes are left out, as
// are podcasts with nothing published yet.
export async function listSitemapEntries(): Promise<SitemapEntry[]> {
  const latest = max(publishedAt).mapWith(episodes.createdAt)
  const shows = await db
    .select({ slug: podcasts.slug, imageUrl: podcasts.imageUrl, lastModified: latest })
    .from(podcasts)
    .innerJoin(episodes, and(eq(episodes.podcastId, podcasts.id), isPublished))
    .where(eq(podcasts.private, false))
    .groupBy(podcasts.id)
    .orderBy(desc(latest))
    .limit(maxEntries)
  const items = await db
    .select({ podcastSlug: podcasts.slug, slug: episodes.slug, lastModified: publishedAt })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(podcasts.private, false), isPublished))
    .orderBy(newestPublishedFirst, desc(episodes.id))
    .limit(maxEntries)
  return [
    ...sitePages.map((path) => ({ path })),
    ...shows.map((show) => ({
      path: podcastPath(show.slug),
      lastModified: show.lastModified,
      image: show.imageUrl ?? undefined,
    })),
    ...items.map((item) => ({ path: episodePath(item.podcastSlug, item.slug), lastModified: item.lastModified })),
  ].slice(0, maxEntries)
}

export function buildSitemap(entries: SitemapEntry[], origin: string) {
  const absolute = (path: string) => escapeXml(new URL(path, origin).toString())
  const urls = entries.map((entry) =>
    [
      '<url>',
      `<loc>${absolute(entry.path)}</loc>`,
      entry.lastModified ? `<lastmod>${entry.lastModified.toISOString()}</lastmod>` : '',
      entry.image ? `<image:image><image:loc>${absolute(entry.image)}</image:loc></image:image>` : '',
      '</url>',
    ].join(''),
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...urls,
    '</urlset>',
  ].join('\n')
}
