// Public pages, by slug. Absolute versions (for feeds, Open Graph and embed
// snippets) are built against the site's public URL on the server.
export function podcastPath(slug: string) {
  return `/podcasts/${slug}`
}

export function episodePath(slug: string, episodeSlug: string) {
  return `/podcasts/${slug}/episodes/${episodeSlug}`
}

export function embedPath(slug: string, episodeSlug: string) {
  return `/embed/${slug}/${episodeSlug}`
}

// An episode on its own, without the site around it, for sharing.
export function listenPath(slug: string, episodeSlug: string) {
  return `/listen/${slug}/${episodeSlug}`
}

// An episode's short link, which redirects to its listen page.
export function shortPath(shortSlug: string) {
  return `/s/${shortSlug}`
}
