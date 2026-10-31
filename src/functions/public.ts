// Server functions for the public pages, which anyone can see, except private
// shows' and episodes', which only their owner can. A signed-in visitor
// also gets where they left off, and whether the show is theirs.
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { episodePageSchema, episodePageSize } from '~/lib/episode-pages'
import { toDomainPath } from '~/lib/custom-domain'
import { openGraphImage } from '~/lib/images'
import { embedPath, episodePath, showPath, shortPath } from '~/lib/paths'
import { getSession } from '~/server/auth.server'
import { listComments } from '~/server/comments.server'
import { currentRequestDomainSlug, requestHost } from '~/server/custom-domains.server'
import { publicUrl } from '~/server/site-url.server'
import {
  findShortLink,
  getEpisodeWaveform,
  getPublicEpisode,
  listNeighbouringEpisodes,
  listPublishedEpisodes,
  summarisePublishedEpisodes,
} from '~/server/episodes.server'
import { feedPath } from '~/server/feed.server'
import { getOpenBroadcast, gifConfig, liveEnabled } from '~/server/live.server'
import { listUserShows } from '~/server/library.server'
import { listPublicPlaylists } from '~/server/playlists.server'
import { getPublicShow } from '~/server/shows.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { getEpisodeTags, getShowTags, withEpisodeTags } from '~/server/tags-store.server'
import { getPublicProfile } from '~/server/users.server'
import { readWaveform, withWaveforms } from '~/server/waveforms.server'

async function visitor() {
  const request = getRequest()
  const session = await getSession(request)
  // On a show's own domain, its pages' links use that domain's short paths.
  const domainSlug = currentRequestDomainSlug()
  const origin = domainSlug ? `https://${requestHost(request)}` : publicUrl(request).origin
  const onDomain = (path: string) => (domainSlug && toDomainPath(path, domainSlug)) || path
  return {
    userId: session?.user?.id ?? null,
    absolute: (path: string) => new URL(onDomain(path), origin).toString(),
  }
}

// The image for the page's link previews, at an absolute URL.
function previewImage(artwork: string | null, absolute: (path: string) => string) {
  if (!artwork) return null
  const image = openGraphImage(artwork)
  return { ...image, url: absolute(image.url) }
}

// A user's public profile (/u/<slug>): who they are, and their public shows.
export const fetchUserProfile = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const { userId } = await visitor()
    const profile = await getPublicProfile(data.slug)
    if (!profile) throw notFound()
    const { id } = profile
    return {
      ...profile,
      // Sanitised when saved; again here, as it's rendered as HTML.
      description: sanitizeDescription(profile.description),
      isYou: userId === id,
      shows: await listUserShows(userId, id),
      playlists: await listPublicPlaylists(id),
    }
  })

// A show's public page, with its first page of episodes; the rest are
// fetched with fetchShowEpisodes as the list is scrolled.
export const fetchShowPage = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const { userId, absolute } = await visitor()
    const show = await getPublicShow(data.slug, userId)
    if (!show) throw notFound()
    const [episodes, summary, broadcast, tags] = await Promise.all([
      listPublishedEpisodes(show.id, userId, { offset: 0, limit: episodePageSize }).then(withEpisodeTags),
      summarisePublishedEpisodes(show.id),
      liveEnabled() ? getOpenBroadcast(show.id) : null,
      getShowTags(show.id),
    ])
    const { userId: ownerId, feedKey, ...rest } = show
    return {
      ...rest,
      tags,
      // Sanitised when saved; again here, as it's rendered as HTML.
      description: sanitizeDescription(show.description),
      isOwner: userId === ownerId,
      pageUrl: absolute(showPath(show.slug)),
      // Only the owner sees a private show, so only they get its key.
      feedUrl: absolute(feedPath(show.slug, show.private ? feedKey : null)),
      previewImage: previewImage(show.imageUrl, absolute),
      // Sanitised when saved; again here, as they're rendered as HTML.
      episodes: await withWaveforms(
        episodes.map((episode) => ({ ...episode, description: sanitizeDescription(episode.description) })),
      ),
      summary,
      // Whether it's broadcasting right now, for a link to its live page.
      live: broadcast !== null,
      // Whether to listen for a broadcast starting.
      liveEnabled: liveEnabled(),
    }
  })

// More of a show's published episodes, for its public page.
export const fetchShowEpisodes = createServerFn({ method: 'GET' })
  .validator(episodePageSchema)
  .handler(async ({ data }) => {
    const { userId } = await visitor()
    const show = await getPublicShow(data.slug, userId)
    if (!show) throw notFound()
    const episodes = await listPublishedEpisodes(show.id, userId, data).then(withEpisodeTags)
    // Sanitised when saved; again here, as they're rendered as HTML.
    return withWaveforms(
      episodes.map((episode) => ({ ...episode, description: sanitizeDescription(episode.description) })),
    )
  })

export const fetchEpisodePage = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string(), episodeSlug: z.string() }))
  .handler(async ({ data }) => {
    const page = await episodePage(data.slug, data.episodeSlug)
    if (!page) throw notFound()
    return page
  })

// An episode's share page (/s/<shortSlug>): the episode on its own.
export const fetchSharePage = createServerFn({ method: 'GET' })
  .validator(z.object({ shortSlug: z.string() }))
  .handler(async ({ data }) => {
    const found = await findShortLink(data.shortSlug.toLowerCase())
    const page = found && (await episodePage(found.slug, found.episodeSlug))
    if (!page) throw notFound()
    return page
  })

async function episodePage(slug: string, episodeSlug: string) {
  const { userId, absolute } = await visitor()
  const found = await getPublicEpisode(slug, episodeSlug, userId)
  if (!found) return null
  const { userId: ownerId, feedKey, ...show } = found.show
  const { episode } = found
  const artwork = episode.imageUrl ?? show.imageUrl
  const [waveform, comments, episodeTags, showTags, moreEpisodes] = await Promise.all([
    readWaveform(episode.id),
    listComments(episode.id, userId),
    getEpisodeTags(episode.id),
    getShowTags(show.id),
    listNeighbouringEpisodes({ ...episode, showId: show.id }),
  ])
  return {
    show: { ...show, tags: showTags },
    episode: {
      ...episode,
      tags: episodeTags,
      // Sanitised when saved; again here, as it's rendered as HTML.
      description: sanitizeDescription(episode.description),
    },
    isOwner: userId === ownerId,
    comments,
    // For GIFs in comments: the provider and its public key, or null without one.
    gifs: gifConfig(),
    // The episodes either side of this one, for "More from" the show.
    moreEpisodes,
    pageUrl: absolute(episodePath(show.slug, episode.slug)),
    // The episode's share page, which the Share button gives out.
    shareUrl: absolute(shortPath(episode.shortSlug)),
    embedUrl: absolute(embedPath(show.slug, episode.slug)),
    // Only the owner sees a private show, so only they get its key.
    feedUrl: absolute(feedPath(show.slug, show.private ? feedKey : null)),
    audioUrl: absolute(episode.audioUrl!),
    previewImage: previewImage(artwork, absolute),
    // The smoother of the two shapes, as Mixcloud draws them.
    waveform: waveform?.rms ?? null,
  }
}

// The playing episode's waveform, for the player bar; null if it has none yet
// (or the visitor may not see the episode).
export const fetchEpisodeWaveform = createServerFn({ method: 'GET' })
  .validator(z.object({ episodeId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { userId } = await visitor()
    return getEpisodeWaveform(userId, data.episodeId)
  })
