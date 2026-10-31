// Schema.org structured data (JSON-LD) for search engines: what a page is
// about, beyond what its HTML says. See https://schema.org/PodcastSeries.
import { showPath } from '~/lib/paths'
import { htmlToText } from '~/lib/rich-text'

type JsonLd = Record<string, unknown>

const plainText = (html: string | null) => (html && htmlToText(html).replace(/\s+/g, ' ').trim()) || undefined

// ISO 8601, as schema.org durations are: 3725 seconds is PT1H2M5S.
export function isoDuration(seconds: number) {
  const whole = Math.round(seconds)
  const [h, m, s] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`
}

export function websiteJsonLd(site: {
  name: string
  origin: string
  description: string
  // The logo's path on the site.
  logo: string
  discordUrl: string | null
}): JsonLd[] {
  const url = new URL('/', site.origin).toString()
  return [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: site.name,
      url,
      logo: new URL(site.logo, site.origin).toString(),
      ...(site.discordUrl && { sameAs: [site.discordUrl] }),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: site.name,
      url,
      description: site.description,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ]
}

export function showSeriesJsonLd(show: {
  title: string
  description: string | null
  pageUrl: string
  feedUrl: string
  image: string | null
  author: string | null
  category: string | null
  // Its pages on Apple Podcasts, Spotify and the rest.
  listings?: string[]
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    name: show.title,
    description: plainText(show.description),
    url: show.pageUrl,
    webFeed: show.feedUrl,
    image: show.image ?? undefined,
    author: show.author ? { '@type': 'Person', name: show.author } : undefined,
    genre: show.category ?? undefined,
    sameAs: show.listings?.length ? show.listings : undefined,
  }
}

// The episode, and the breadcrumbs from the site to it through its show.
export function showEpisodeJsonLd(page: {
  siteName: string
  show: { title: string; slug: string }
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
  const showUrl = new URL(showPath(page.show.slug), page.pageUrl).toString()
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
      partOfSeries: { '@type': 'PodcastSeries', name: page.show.title, url: showUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: page.siteName, item: new URL('/', page.pageUrl).toString() },
        { '@type': 'ListItem', position: 2, name: page.show.title, item: showUrl },
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
