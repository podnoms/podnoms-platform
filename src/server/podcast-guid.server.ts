// The feed's permanent id (Podcasting 2.0's podcast:guid).
import '@tanstack/react-start/server-only'
import { feedPath, type ShowRef } from '~/lib/paths'
import { siteOrigin } from '~/server/site-url.server'
import { uuidV5 } from '~/server/uuid.server'

// A UUIDv5 of the feed's URL without the scheme or trailing slashes, as the
// namespace says, so any host that moves the feed can work out the same one.
export function podcastGuid(feedUrl: string) {
  return uuidV5(feedUrl.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, ''), 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6')
}

// A new show's, from its first feed URL. It's kept (shows.podcastGuid) when
// the owner's or show's slug, and so the URL, changes. Random without
// SITE_URL, as there's no URL to make it from outside a request.
export function newPodcastGuid(show: ShowRef) {
  const origin = siteOrigin()
  return origin ? podcastGuid(new URL(feedPath(show), origin).toString()) : crypto.randomUUID()
}
