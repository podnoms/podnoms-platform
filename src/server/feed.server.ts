// A podcast's RSS feed, with the iTunes tags podcast apps expect. Descriptions
// are HTML, which RSS carries escaped; the iTunes summaries are plain text.
import '@tanstack/react-start/server-only'
import { and, eq } from 'drizzle-orm'
import { episodePath, podcastPath } from '~/lib/paths'
import { htmlToText } from '~/lib/rich-text'
import { db } from '~/server/db/client.server'
import { episodes, podcasts, users } from '~/server/db/schema'
import { isPublished, newestPublishedFirst } from '~/server/episodes.server'

export function feedPath(slug: string) {
  return `/feed/${slug}`
}

function escapeXml(text: string) {
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

function itunesExplicit(explicit: boolean) {
  return explicit ? 'true' : 'false'
}

// Null if there's no podcast with that slug. Private podcasts have feeds too:
// they're unlisted, not secret, and the feed is how listeners subscribe.
export async function buildPodcastFeed(slug: string, origin: string) {
  const [podcast] = await db
    .select({
      id: podcasts.id,
      title: podcasts.title,
      slug: podcasts.slug,
      description: podcasts.description,
      imageUrl: podcasts.imageUrl,
      category: podcasts.category,
      language: podcasts.language,
      explicit: podcasts.explicit,
      private: podcasts.private,
      updatedAt: podcasts.updatedAt,
      author: users.name,
    })
    .from(podcasts)
    .innerJoin(users, eq(users.id, podcasts.userId))
    .where(eq(podcasts.slug, slug))
    .limit(1)
  if (!podcast) return null

  const items = await db
    .select()
    .from(episodes)
    .where(and(eq(episodes.podcastId, podcast.id), isPublished))
    .orderBy(newestPublishedFirst)

  const absolute = (url: string) => new URL(url, origin).toString()
  const feedUrl = absolute(feedPath(podcast.slug))
  const pageUrl = absolute(podcastPath(podcast.slug))
  const artwork = podcast.imageUrl ?? items.find((item) => item.imageUrl)?.imageUrl ?? null
  const description = podcast.description || podcast.title
  const latest = items[0] ? (items[0].publishedAt ?? items[0].createdAt) : podcast.updatedAt

  const itemXml = items.map((item) => {
    const published = item.publishedAt ?? item.createdAt
    return [
      '<item>',
      tag('title', item.title),
      tag('link', absolute(episodePath(podcast.slug, item.slug))),
      tag('description', item.description),
      tag('itunes:summary', item.description && htmlToText(item.description)),
      `<guid isPermaLink="false">${escapeXml(item.id)}</guid>`,
      `<pubDate>${published.toUTCString()}</pubDate>`,
      `<enclosure url="${escapeXml(absolute(item.audioUrl!))}" length="${item.audioSizeBytes ?? 0}" type="${escapeXml(item.audioMimeType ?? 'audio/mpeg')}"/>`,
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
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    ${[
      tag('title', podcast.title),
      tag('link', pageUrl),
      `<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
      tag('description', description),
      tag('itunes:summary', htmlToText(description)),
      tag('language', podcast.language),
      tag('itunes:author', podcast.author),
      artwork ? `<itunes:image href="${escapeXml(absolute(artwork))}"/>` : '',
      artwork ? `<image><url>${escapeXml(absolute(artwork))}</url>${tag('title', podcast.title)}${tag('link', pageUrl)}</image>` : '',
      podcast.category ? `<itunes:category text="${escapeXml(podcast.category)}"/>` : '',
      `<itunes:explicit>${itunesExplicit(podcast.explicit)}</itunes:explicit>`,
      // Keeps unlisted podcasts out of directories that honour it.
      podcast.private ? '<itunes:block>Yes</itunes:block>' : '',
      '<itunes:type>episodic</itunes:type>',
      '<generator>podnoms</generator>',
      `<lastBuildDate>${latest.toUTCString()}</lastBuildDate>`,
      ...itemXml,
    ]
      .filter(Boolean)
      .join('\n    ')}
  </channel>
</rss>
`
}
