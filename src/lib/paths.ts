// Public pages, by slug. Absolute versions (for feeds, Open Graph and embed
// snippets) are built against the site's public URL on the server.
//
// The top level belongs to users: /<user> is their profile, and their shows
// and everything about them are under it (/<user>/<show>/<episode>, and the
// show's feed, live and manage pages). So there are three namespaces, each
// with names the site's own routes take: reservedUserSlugs at the top,
// reservedShowSlugs under a user and reservedEpisodeSlugs under a show
// (tests/lib/paths.test.ts checks each against src/routes).

// A show, as its address needs it: its owner's slug and its own (unique
// per owner).
export type ShowRef = { ownerSlug: string; slug: string }

export function userPath(slug: string) {
  return `/${slug}`
}

export function showPath(show: ShowRef) {
  return `/${show.ownerSlug}/${show.slug}`
}

export function showManagePath(show: ShowRef) {
  return `${showPath(show)}/manage`
}

// The show's RSS feed.
export function feedPath(show: ShowRef) {
  return `${showPath(show)}/feed`
}

// The show's live page: its broadcast, when there is one, and its chat.
export function livePath(show: ShowRef) {
  return `${showPath(show)}/live`
}

export function episodePath(show: ShowRef, episodeSlug: string) {
  return `${showPath(show)}/${episodeSlug}`
}

export function episodeManagePath(show: ShowRef, episodeSlug: string) {
  return `${episodePath(show, episodeSlug)}/manage`
}

export function embedPath(show: ShowRef, episodeSlug: string) {
  return `/embed/${show.ownerSlug}/${show.slug}/${episodeSlug}`
}

export function playlistPath(userSlug: string, playlistSlug: string) {
  return `/${userSlug}/playlists/${playlistSlug}`
}

// Route params for <Link to="/$user/$show…">.
export function showParams(show: ShowRef) {
  return { user: show.ownerSlug, show: show.slug }
}

export function episodeParams(show: ShowRef, episodeSlug: string) {
  return { ...showParams(show), episode: episodeSlug }
}

// The site's own top-level paths, which a user slug would clash with, and
// ones that would look official or like a way to mention everyone. Some
// are spare, for pages to come.
export const reservedUserSlugs = new Set([
  'about',
  'admin',
  'administrator',
  'api',
  'assets',
  'brand',
  'embed',
  'everyone',
  'explore',
  'feed',
  'following',
  'fonts',
  'help',
  'here',
  'images',
  'likes',
  'listen',
  'live',
  'login',
  'logout',
  'me',
  'moderator',
  'official',
  'playlists',
  'podcasts',
  'podnoms',
  'privacy',
  'reset-password',
  'root',
  's',
  'search',
  'security',
  'settings',
  'shows',
  'signup',
  'src',
  'staff',
  'support',
  'system',
  'tags',
  'tos',
  'u',
])

// Paths under a user that a show slug would clash with.
export const reservedShowSlugs = new Set(['playlists', 'likes', 'following', 'followers', 'shows'])

// Paths under a show that an episode slug would clash with.
export const reservedEpisodeSlugs = new Set(['manage', 'feed', 'live'])

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
