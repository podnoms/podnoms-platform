import { htmlToText } from '~/lib/rich-text'

// Head tags for a public page: its title, a description and image for link
// previews (Open Graph), the podcast's feed for apps to discover, and noindex
// for unlisted podcasts. A page shared at another URL (shareUrl) still names
// `url` as the one to index.
export function publicPageHead(page: {
  title: string
  description: string | null
  url: string
  shareUrl?: string
  imageUrl: string | null
  type: 'website' | 'music.song'
  audioUrl?: string
  feedUrl: string
  feedTitle: string
  noindex: boolean
}) {
  const description = page.description ? htmlToText(page.description).replace(/\s+/g, ' ').trim().slice(0, 300) : null
  const meta = [
    { title: `${page.title} · podnoms` },
    description && { name: 'description', content: description },
    { property: 'og:site_name', content: 'podnoms' },
    { property: 'og:title', content: page.title },
    { property: 'og:type', content: page.type },
    { property: 'og:url', content: page.shareUrl ?? page.url },
    description && { property: 'og:description', content: description },
    page.imageUrl && { property: 'og:image', content: page.imageUrl },
    page.audioUrl && { property: 'og:audio', content: page.audioUrl },
    { name: 'twitter:card', content: page.imageUrl ? 'summary_large_image' : 'summary' },
    page.noindex && { name: 'robots', content: 'noindex' },
  ].filter((tag) => !!tag)
  const links = [
    { rel: 'canonical', href: page.url },
    { rel: 'alternate', type: 'application/rss+xml', title: page.feedTitle, href: page.feedUrl },
  ]
  return { meta, links }
}
