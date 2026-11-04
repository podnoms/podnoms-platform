// Server functions for the public pages, which anyone can see, except private
// shows' and episodes', which only their owner can. A signed-in visitor
// also gets where they left off, and whether the show is theirs.
import { notFound, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { episodePageSchema, episodePageSize } from '~/lib/episode-pages'
import { toDomainPath } from '~/lib/custom-domain'
import { openGraphImage } from '~/lib/images'
import { embedPath, episodePath, showPath, shortPath, userPath, type ShowRef } from '~/lib/paths'
import { asShowRef, showAddressSchema } from '~/lib/show-schema'
import { showMovedOrNotFound } from '~/server/show-address.server'
import { getSession } from '~/server/auth.server'
import { listComments } from '~/server/comments.server'
import { currentRequestDomainShow, requestHost } from '~/server/custom-domains.server'
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
import { getPublicShow, servedShowTheme } from '~/server/shows.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { getEpisodeTags, getShowTags, withEpisodeTags } from '~/server/tags-store.server'
import { getPublicProfile, movedUser } from '~/server/users.server'
import { readWaveform, withWaveforms } from '~/server/waveforms.server'

async function visitor() {
  const request = getRequest()
  const session = await getSession(request)
  // On a show's own domain, its pages' links use that domain's short paths.
  const domainShow = currentRequestDomainShow()
  const origin = domainShow ? `https://${requestHost(request)}` : publicUrl(request).origin
  const onDomain = (path: string) => (domainShow && toDomainPath(path, domainShow)) || path
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

// A user's public profile (/<slug>): who they are, and their public shows.
// Their old slugs redirect to it.
export const fetchUserProfile = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const { userId } = await visitor()
    const profile = await getPublicProfile(data.slug)
    if (!profile) {
      const moved = await movedUser(data.slug)
      if (moved) throw redirect({ href: userPath(moved), statusCode: 301 })
      throw notFound()
    }
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
  .validator(showAddressSchema)
  .handler(async ({ data }) => {
    const { userId, absolute } = await visitor()
    const ref = asShowRef(data)
    const show = await getPublicShow(ref, userId)
    if (!show) return showMovedOrNotFound(ref, showPath)
    const [episodes, summary, broadcast, tags] = await Promise.all([
      listPublishedEpisodes(show.id, userId, { offset: 0, limit: episodePageSize }).then(withEpisodeTags),
      summarisePublishedEpisodes(show.id),
      liveEnabled() ? getOpenBroadcast(show.id) : null,
      getShowTags(show.id),
    ])
    const { userId: ownerId, feedKey, theme, ...rest } = show
    return {
      ...rest,
      // The owner's theme for the show's pages, if they've given it one.
      theme: await servedShowTheme(ownerId, theme),
      tags,
      // Sanitised when saved; again here, as it's rendered as HTML.
      description: sanitizeDescription(show.description),
      isOwner: userId === ownerId,
      pageUrl: absolute(showPath(show)),
      // Only the owner sees a private show, so only they get its key.
      feedUrl: absolute(feedPath(show, show.private ? feedKey : null)),
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
    const show = await getPublicShow({ id: data.showId }, userId)
    if (!show) throw notFound()
    const episodes = await listPublishedEpisodes(show.id, userId, data).then(withEpisodeTags)
    // Sanitised when saved; again here, as they're rendered as HTML.
    return withWaveforms(
      episodes.map((episode) => ({ ...episode, description: sanitizeDescription(episode.description) })),
    )
  })

export const fetchEpisodePage = createServerFn({ method: 'GET' })
  .validator(showAddressSchema.extend({ episode: z.string() }))
  .handler(async ({ data }) => {
    const ref = asShowRef(data)
    const page = await episodePage(ref, data.episode)
    if (!page) return showMovedOrNotFound(ref, (show) => episodePath(show, data.episode))
    return page
  })

// An episode's share page (/s/<shortSlug>): the episode on its own.
export const fetchSharePage = createServerFn({ method: 'GET' })
  .validator(z.object({ shortSlug: z.string() }))
  .handler(async ({ data }) => {
    const found = await findShortLink(data.shortSlug.toLowerCase())
    const page = found && (await episodePage({ id: found.showId }, found.episodeSlug))
    if (!page) throw notFound()
    return page
  })

async function episodePage(key: ShowRef | { id: string }, episodeSlug: string) {
  const { userId, absolute } = await visitor()
  const found = await getPublicEpisode(key, episodeSlug, userId)
  if (!found) return null
  const { userId: ownerId, feedKey, theme, ...show } = found.show
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
    // The owner's theme for the show's pages, if they've given it one.
    theme: await servedShowTheme(ownerId, theme),
    comments,
    // For GIFs in comments: the provider and its public key, or null without one.
    gifs: gifConfig(),
    // The episodes either side of this one, for "More from" the show.
    moreEpisodes,
    pageUrl: absolute(episodePath(show, episode.slug)),
    // The episode's share page, which the Share button gives out.
    shareUrl: absolute(shortPath(episode.shortSlug)),
    embedUrl: absolute(embedPath(show, episode.slug)),
    // Only the owner sees a private show, so only they get its key.
    feedUrl: absolute(feedPath(show, show.private ? feedKey : null)),
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
