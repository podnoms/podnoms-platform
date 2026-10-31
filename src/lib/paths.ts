// Public pages, by slug. Absolute versions (for feeds, Open Graph and embed
// snippets) are built against the site's public URL on the server.
// Shows are at the top level, so their slugs can't be any of
// reservedShowSlugs.
export function showPath(slug: string) {
  return `/${slug}`
}

// Episodes are right under their show, so their slugs can't be any of
// reservedEpisodeSlugs.
export function episodePath(slug: string, episodeSlug: string) {
  return `/${slug}/${episodeSlug}`
}

// Paths under a show that an episode slug would clash with: the show's manage
// page, and the old /<show>/episodes/<episode> addresses, which redirect.
export const reservedEpisodeSlugs = new Set(['episodes', 'manage'])

// The site's own top-level paths, which a show slug would clash with
// (tests/lib/paths.test.ts checks every route in src/routes is here). Some
// are spare, for pages to come.
export const reservedShowSlugs = new Set([
  'about',
  'admin',
  'api',
  'assets',
  'brand',
  'embed',
  'explore',
  'feed',
  'following',
  'fonts',
  'help',
  'images',
  'likes',
  'listen',
  'live',
  'login',
  'logout',
  'playlists',
  'podcasts',
  'privacy',
  'reset-password',
  's',
  'search',
  'security',
  'settings',
  'shows',
  'signup',
  'src',
  'tags',
  'tos',
  'u',
])

// A user's public profile (see userSlugSchema).
export function userPath(slug: string) {
  return `/u/${slug}`
}

// The show's live page: its broadcast, when there is one, and its chat.
export function livePath(slug: string) {
  return `/live/${slug}`
}

export function embedPath(slug: string, episodeSlug: string) {
  return `/embed/${slug}/${episodeSlug}`
}

// An episode's share page: the episode on its own, without the site around it.
export function shortPath(shortSlug: string) {
  return `/s/${shortSlug}`
}

// An episode's share page through a tracked link, which counts its opens and plays.
export function trackedSharePath(shortSlug: string, token: string) {
  return `${shortPath(shortSlug)}?t=${encodeURIComponent(token)}`
}

// A URL or path with a private show's feed key added, so its feed and audio
// links work in podcast apps, which can't sign in. Unchanged without a key.
export function withFeedKey(url: string, feedKey: string | null | undefined) {
  return feedKey ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(feedKey)}` : url
}
