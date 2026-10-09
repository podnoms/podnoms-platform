// Schema.org structured data (JSON-LD) for search engines: what a page is
// about, beyond what its HTML says. See https://schema.org/PodcastSeries.
import { podcastPath } from '~/lib/paths'
import { htmlToText } from '~/lib/rich-text'

type JsonLd = Record<string, unknown>

const plainText = (html: string | null) => (html && htmlToText(html).replace(/\s+/g, ' ').trim()) || undefined

// ISO 8601, as schema.org durations are: 3725 seconds is PT1H2M5S.
export function isoDuration(seconds: number) {
  const whole = Math.round(seconds)
  const [h, m, s] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`
}

export function websiteJsonLd(site: { origin: string; description: string; discordUrl: string | null }): JsonLd[] {
  const url = new URL('/', site.origin).toString()
  return [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'podnoms', url },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'podnoms',
      url,
      logo: new URL('/logo.png', site.origin).toString(),
      ...(site.discordUrl && { sameAs: [site.discordUrl] }),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'podnoms',
      url,
      description: site.description,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ]
}

export function podcastSeriesJsonLd(podcast: {
  title: string
  description: string | null
  pageUrl: string
  feedUrl: string
  image: string | null
  author: string | null
  category: string | null
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    name: podcast.title,
    description: plainText(podcast.description),
    url: podcast.pageUrl,
    webFeed: podcast.feedUrl,
    image: podcast.image ?? undefined,
    author: podcast.author ? { '@type': 'Person', name: podcast.author } : undefined,
    genre: podcast.category ?? undefined,
  }
}

// The episode, and the breadcrumbs from the site to it through its podcast.
export function podcastEpisodeJsonLd(page: {
  podcast: { title: string; slug: string }
  episode: {
    title: string
    description: string | null
    publishedAt: Date | string | null
    createdAt: Date | string
    durationSeconds: number | null
  }
  pageUrl: string
  audioUrl: string
  image: string | null
}): JsonLd[] {
  const podcastUrl = new URL(podcastPath(page.podcast.slug), page.pageUrl).toString()
  const duration = page.episode.durationSeconds ? isoDuration(page.episode.durationSeconds) : undefined
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'PodcastEpisode',
      name: page.episode.title,
      description: plainText(page.episode.description),
      url: page.pageUrl,
      datePublished: new Date(page.episode.publishedAt ?? page.episode.createdAt).toISOString(),
      duration,
      image: page.image ?? undefined,
      associatedMedia: { '@type': 'AudioObject', contentUrl: page.audioUrl, encodingFormat: 'audio/mpeg', duration },
      partOfSeries: { '@type': 'PodcastSeries', name: page.podcast.title, url: podcastUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'podnoms', item: new URL('/', page.pageUrl).toString() },
        { '@type': 'ListItem', position: 2, name: page.podcast.title, item: podcastUrl },
        { '@type': 'ListItem', position: 3, name: page.episode.title, item: page.pageUrl },
      ],
    },
  ]
}

// A head `meta` entry for the data. TanStack renders it as a JSON-LD script,
// escaping it so that users' own text in it can't close the script element.
export function jsonLdMeta(data: JsonLd | JsonLd[]) {
  return { 'script:ld+json': data }
}
