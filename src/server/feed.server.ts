// A show's RSS feed, with the iTunes tags podcast apps expect. Descriptions
// are HTML, which RSS carries escaped; the iTunes summaries are plain text.
import '@tanstack/react-start/server-only'
import { and, eq } from 'drizzle-orm'
import { domainFeedPath, toDomainPath } from '~/lib/custom-domain'
import { episodePath, showPath, withFeedKey } from '~/lib/paths'
import { htmlToText } from '~/lib/rich-text'
import { db } from '~/server/db/client.server'
import { episodes, shows, users } from '~/server/db/schema'
import { isListed, newestPublishedFirst } from '~/server/episodes.server'
import { showAuthor } from '~/server/shows.server'
import { uuidV5 } from '~/server/uuid.server'
import { getBranding } from '~/server/branding.server'

// A private show's feed is only served with its feed key.
export function feedPath(slug: string, feedKey?: string | null) {
  return withFeedKey(`/feed/${slug}`, feedKey)
}


export function escapeXml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// <name>text</name>, or nothing when there's no text.
function tag(name: string, text: string | null | undefined, attributes = '') {
  return text ? `<${name}${attributes}>${escapeXml(text)}</${name}>` : ''
}

// Apple's category, with its subcategory nested inside.
function categoryXml(category: string | null, subcategory: string | null) {
  if (!category) return ''
  const open = `<itunes:category text="${escapeXml(category)}"`
  return subcategory ? `${open}><itunes:category text="${escapeXml(subcategory)}"/></itunes:category>` : `${open}/>`
}

// The feed's permanent id (Podcasting 2.0's podcast:guid): a UUIDv5 of its URL
// without the scheme or trailing slashes, so any host that moves the feed can
// work out the same one.
export function podcastGuid(feedUrl: string) {
  return uuidV5(feedUrl.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, ''), 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6')
}

function itunesExplicit(explicit: boolean) {
  return explicit ? 'true' : 'false'
}

// Null if there's no show with that slug. Private shows have feeds too,
// as that's how their listeners subscribe, but only with the show's feed
// key (options.key); their audio links carry it too.
export async function buildShowFeed(
  slug: string,
  origin: string,
  options: { domain?: string; key?: string | null } = {},
) {
  const [show] = await db
    .select({
      id: shows.id,
      title: shows.title,
      slug: shows.slug,
      description: shows.description,
      imageUrl: shows.imageUrl,
      category: shows.category,
      subcategory: shows.subcategory,
      language: shows.language,
      explicit: shows.explicit,
      private: shows.private,
      feedKey: shows.feedKey,
      updatedAt: shows.updatedAt,
      author: showAuthor,
      ownerEmail: shows.ownerEmail,
    })
    .from(shows)
    .innerJoin(users, eq(users.id, shows.userId))
    .where(eq(shows.slug, slug))
    .limit(1)
  if (!show) return null
  if (show.private && (!show.feedKey || options.key !== show.feedKey)) return null
  const key = show.private ? show.feedKey : null

  const items = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.showId, show.id), isListed))
    .orderBy(newestPublishedFirst)

  // On the show's own domain, its links are to that domain's short paths.
  const domainOrigin = options.domain ? `https://${options.domain}` : null
  const absolute = (url: string) => new URL(url, domainOrigin ?? origin).toString()
  const page = (path: string) => (options.domain ? (toDomainPath(path, show.slug) ?? path) : path)
  const siteFeedUrl = new URL(feedPath(show.slug), origin).toString()
  const feedUrl = withFeedKey(options.domain ? absolute(domainFeedPath) : siteFeedUrl, key)
  const pageUrl = absolute(page(showPath(show.slug)))
  const artwork = show.imageUrl ?? items.find((item) => item.imageUrl)?.imageUrl ?? null
  const description = show.description || show.title
  const latest = items[0] ? (items[0].publishedAt ?? items[0].createdAt) : show.updatedAt

  const itemXml = items.map((item) => {
    const published = item.publishedAt ?? item.createdAt
    return [
      '<item>',
      tag('title', item.title),
      tag('link', absolute(page(episodePath(show.slug, item.slug)))),
      tag('description', item.description),
      tag('itunes:summary', item.description && htmlToText(item.description)),
      `<guid isPermaLink="false">${escapeXml(item.id)}</guid>`,
      `<pubDate>${published.toUTCString()}</pubDate>`,
      `<enclosure url="${escapeXml(withFeedKey(absolute(item.audioUrl!), key))}" length="${item.audioSizeBytes ?? 0}" type="${escapeXml(item.audioMimeType ?? 'audio/mpeg')}"/>`,
      // Plain seconds, which podcast apps accept as well as HH:MM:SS.
      item.durationSeconds ? `<itunes:duration>${item.durationSeconds}</itunes:duration>` : '',
      item.imageUrl ? `<itunes:image href="${escapeXml(absolute(item.imageUrl))}"/>` : '',
      `<itunes:explicit>${itunesExplicit(item.explicit)}</itunes:explicit>`,
      '<itunes:episodeType>full</itunes:episodeType>',
      '</item>',
    ]
      .filter(Boolean)
      .join('\n      ')
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    ${[
      tag('title', show.title),
      tag('link', pageUrl),
      `<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
      tag('description', description),
      tag('itunes:summary', htmlToText(description)),
      tag('language', show.language),
      tag('itunes:author', show.author),
      artwork ? `<itunes:image href="${escapeXml(absolute(artwork))}"/>` : '',
      artwork ? `<image><url>${escapeXml(absolute(artwork))}</url>${tag('title', show.title)}${tag('link', pageUrl)}</image>` : '',
      categoryXml(show.category, show.subcategory),
      show.ownerEmail
        ? `<itunes:owner>${tag('itunes:name', show.author ?? show.title)}${tag('itunes:email', show.ownerEmail)}</itunes:owner>`
        : '',
      `<itunes:explicit>${itunesExplicit(show.explicit)}</itunes:explicit>`,
      // Keeps private shows out of directories that honour it.
      show.private ? '<itunes:block>Yes</itunes:block>' : '',
      '<itunes:type>episodic</itunes:type>',
      // From the site's feed URL, so the show keeps one id on any domain.
      `<podcast:guid>${podcastGuid(siteFeedUrl)}</podcast:guid>`,
      // Asks other hosts not to import the feed, unless the owner (who can be
      // emailed) agrees.
      show.ownerEmail
        ? `<podcast:locked owner="${escapeXml(show.ownerEmail)}">yes</podcast:locked>`
        : '<podcast:locked>no</podcast:locked>',
      `<generator>${escapeXml((await getBranding()).name)}</generator>`,
      `<lastBuildDate>${latest.toUTCString()}</lastBuildDate>`,
      ...itemXml,
    ]
      .filter(Boolean)
      .join('\n    ')}
  </channel>
</rss>
`
}
