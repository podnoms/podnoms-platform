import { htmlToText } from '~/lib/rich-text'

// Head tags for a public page: its title, a description and image for link
// previews (Open Graph), the podcast's feed for apps to discover, and noindex
// for unlisted podcasts. A page shared at another URL (shareUrl) still names
// `url` as the one to index.
export function publicPageHead(page: {
  title: string
  description: string | null
  // Used when there's no description, as link previews expect one.
  fallbackDescription: string
  url: string
  shareUrl?: string
  image: { url: string; width?: number; height?: number } | null
  type: 'website' | 'music.song'
  audioUrl?: string
  feedUrl: string
  feedTitle: string
  noindex: boolean
}) {
  const description =
    (page.description && htmlToText(page.description).replace(/\s+/g, ' ').trim().slice(0, 300)) || page.fallbackDescription
  const meta = [
    { title: `${page.title} · podnoms` },
    { name: 'description', content: description },
    { property: 'og:site_name', content: 'podnoms' },
    { property: 'og:title', content: page.title },
    { property: 'og:type', content: page.type },
    { property: 'og:url', content: page.shareUrl ?? page.url },
    { property: 'og:description', content: description },
    ...imageTags(page.image, page.title),
    page.audioUrl && { property: 'og:audio', content: page.audioUrl },
    page.noindex && { name: 'robots', content: 'noindex' },
  ].filter((tag) => !!tag)
  const links = [
    { rel: 'canonical', href: page.url },
    { rel: 'alternate', type: 'application/rss+xml', title: page.feedTitle, href: page.feedUrl },
  ]
  return { meta, links }
}

// Open Graph tags for the page's image. Stored artwork comes as a 1200×630
// JPEG (see openGraphImage), so it can be shown as a large card; other images'
// size and shape are unknown, so they get a small one.
function imageTags(image: { url: string; width?: number; height?: number } | null, title: string) {
  if (!image) return [{ name: 'twitter:card', content: 'summary' }]
  const alt = `Artwork for ${title}`
  const sized = image.width && image.height
  return [
    { property: 'og:image', content: image.url },
    image.url.startsWith('https:') && { property: 'og:image:secure_url', content: image.url },
    sized && { property: 'og:image:type', content: 'image/jpeg' },
    sized && { property: 'og:image:width', content: String(image.width) },
    sized && { property: 'og:image:height', content: String(image.height) },
    { property: 'og:image:alt', content: alt },
    { name: 'twitter:card', content: sized ? 'summary_large_image' : 'summary' },
    { name: 'twitter:image:alt', content: alt },
  ]
}
