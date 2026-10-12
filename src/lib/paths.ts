// Public pages, by slug. Absolute versions (for feeds, Open Graph and embed
// snippets) are built against the site's public URL on the server.
export function podcastPath(slug: string) {
  return `/podcasts/${slug}`
}

export function episodePath(slug: string, episodeSlug: string) {
  return `/podcasts/${slug}/episodes/${episodeSlug}`
}

// The podcast's live page: its broadcast, when there is one, and its chat.
export function livePath(slug: string) {
  return `${podcastPath(slug)}/live`
}

export function embedPath(slug: string, episodeSlug: string) {
  return `/embed/${slug}/${episodeSlug}`
}

// An episode's share page: the episode on its own, without the site around it.
export function shortPath(shortSlug: string) {
  return `/s/${shortSlug}`
}

// A URL or path with a private podcast's feed key added, so its feed and audio
// links work in podcast apps, which can't sign in. Unchanged without a key.
export function withFeedKey(url: string, feedKey: string | null | undefined) {
  return feedKey ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(feedKey)}` : url
}
