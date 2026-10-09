import { htmlToText } from '~/lib/rich-text'

type Image = { url: string; width?: number; height?: number; type?: string }

// The card shown when a page without its own artwork (the landing page, say)
// is shared: public/og-default.png.
export const defaultImage = { path: '/og-default.png', width: 1200, height: 630, type: 'image/png' } as const

// The default card, at an absolute URL on the same site as `base`.
function defaultImageAt(base: string): Image {
  const { path, ...size } = defaultImage
  return { url: new URL(path, base).toString(), ...size }
}

// Head tags for a public page: its title, a description and image for link
// previews (Open Graph), the podcast's feed for apps to discover, and noindex
// for unlisted podcasts. A page shared at another URL (shareUrl) still names
// `url` as the one to index. `documentTitle` replaces the title in the browser
// tab and search results, where the episode's podcast is worth naming.
export function publicPageHead(page: {
  title: string
  documentTitle?: string
  description: string | null
  // Used when there's no description, as link previews expect one.
  fallbackDescription: string
  url: string
  shareUrl?: string
  image: Image | null
  type: 'website' | 'music.song'
  audioUrl?: string
  feedUrl: string
  feedTitle: string
  noindex: boolean
}) {
  const text = (page.description && htmlToText(page.description).replace(/\s+/g, ' ').trim()) || page.fallbackDescription
  const meta = [
    { title: `${page.documentTitle ?? page.title} · podnoms` },
    ...socialTags({
      ...page,
      description: text,
      url: page.shareUrl ?? page.url,
      // Without artwork, the site's own card.
      image: page.image ?? defaultImageAt(page.url),
      imageAlt: page.image ? `Artwork for ${page.title}` : 'podnoms',
    }),
    page.audioUrl && { property: 'og:audio', content: page.audioUrl },
    page.audioUrl && { property: 'og:audio:type', content: 'audio/mpeg' },
    page.noindex && { name: 'robots', content: 'noindex' },
  ].filter((tag) => !!tag)
  const links = [
    { rel: 'canonical', href: page.url },
    { rel: 'alternate', type: 'application/rss+xml', title: page.feedTitle, href: page.feedUrl },
  ]
  return { meta, links }
}

// Head tags for the site's own pages (the landing page, privacy policy and
// terms), shared with the default card.
export function siteHead(page: { origin: string; path: string; title: string; description: string }) {
  const url = new URL(page.path, page.origin).toString()
  return {
    meta: [
      { title: page.title },
      ...socialTags({ ...page, url, image: defaultImageAt(page.origin), type: 'website', imageAlt: 'podnoms' }),
    ],
    links: [{ rel: 'canonical', href: url }],
  }
}

// Search results show about 160 characters; link previews take more.
const searchDescriptionLength = 160
const previewDescriptionLength = 300

// Cuts text to `length` characters at a word boundary, marking the cut.
export function truncate(text: string, length: number) {
  if (text.length <= length) return text
  const cut = text.slice(0, length - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > length / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`
}

// The description, Open Graph and Twitter tags any shareable page has.
function socialTags(page: {
  title: string
  description: string
  url: string
  image: Image
  imageAlt: string
  type: 'website' | 'music.song'
}) {
  const description = truncate(page.description, previewDescriptionLength)
  return [
    { name: 'description', content: truncate(page.description, searchDescriptionLength) },
    { property: 'og:site_name', content: 'podnoms' },
    { property: 'og:title', content: page.title },
    { property: 'og:type', content: page.type },
    { property: 'og:url', content: page.url },
    { property: 'og:description', content: description },
    ...imageTags(page.image, page.imageAlt),
  ]
}

// Open Graph tags for the page's image. Stored artwork comes as a 1200×630
// JPEG (see openGraphImage), so it can be shown as a large card, as can the
// default card; other images' size and shape are unknown, so they get a small one.
function imageTags(image: Image, alt: string) {
  const sized = image.width && image.height
  return [
    { property: 'og:image', content: image.url },
    image.url.startsWith('https:') && { property: 'og:image:secure_url', content: image.url },
    sized && { property: 'og:image:type', content: image.type ?? 'image/jpeg' },
    sized && { property: 'og:image:width', content: String(image.width) },
    sized && { property: 'og:image:height', content: String(image.height) },
    { property: 'og:image:alt', content: alt },
    { name: 'twitter:card', content: sized ? 'summary_large_image' : 'summary' },
    { name: 'twitter:image:alt', content: alt },
  ].filter((tag) => !!tag)
}
