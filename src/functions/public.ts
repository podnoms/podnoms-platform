// Server functions for the public pages, which anyone can see. A signed-in
// visitor also gets where they left off, and whether the podcast is theirs.
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { episodePageSchema, episodePageSize } from '~/lib/episode-pages'
import { toDomainPath } from '~/lib/custom-domain'
import { openGraphImage } from '~/lib/images'
import { embedPath, episodePath, podcastPath, shortPath } from '~/lib/paths'
import { getSession } from '~/server/auth.server'
import { currentRequestDomainSlug, requestHost } from '~/server/custom-domains.server'
import { publicUrl } from '~/server/site-url.server'
import {
  findShortLink,
  getPublicEpisode,
  listPublishedEpisodes,
  summarisePublishedEpisodes,
} from '~/server/episodes.server'
import { feedPath } from '~/server/feed.server'
import { getPublicPodcast } from '~/server/podcasts.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { readWaveform } from '~/server/waveforms.server'

async function visitor() {
  const request = getRequest()
  const session = await getSession(request)
  // On a podcast's own domain, its pages' links use that domain's short paths.
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

// A podcast's public page, with its first page of episodes; the rest are
// fetched with fetchPodcastEpisodes as the list is scrolled.
export const fetchPodcastPage = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const { userId, absolute } = await visitor()
    const podcast = await getPublicPodcast(data.slug)
    if (!podcast) throw notFound()
    const [episodes, summary] = await Promise.all([
      listPublishedEpisodes(podcast.id, userId, { offset: 0, limit: episodePageSize }),
      summarisePublishedEpisodes(podcast.id),
    ])
    const { userId: ownerId, ...rest } = podcast
    return {
      ...rest,
      // Sanitised when saved; again here, as it's rendered as HTML.
      description: sanitizeDescription(podcast.description),
      isOwner: userId === ownerId,
      pageUrl: absolute(podcastPath(podcast.slug)),
      feedUrl: absolute(feedPath(podcast.slug)),
      previewImage: previewImage(podcast.imageUrl, absolute),
      // Sanitised when saved; again here, as they're rendered as HTML.
      episodes: episodes.map((episode) => ({ ...episode, description: sanitizeDescription(episode.description) })),
      summary,
    }
  })

// More of a podcast's published episodes, for its public page.
export const fetchPodcastEpisodes = createServerFn({ method: 'GET' })
  .validator(episodePageSchema)
  .handler(async ({ data }) => {
    const { userId } = await visitor()
    const podcast = await getPublicPodcast(data.slug)
    if (!podcast) throw notFound()
    const episodes = await listPublishedEpisodes(podcast.id, userId, data)
    // Sanitised when saved; again here, as they're rendered as HTML.
    return episodes.map((episode) => ({ ...episode, description: sanitizeDescription(episode.description) }))
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
  const { userId: ownerId, ...podcast } = found.podcast
  const { episode } = found
  const artwork = episode.imageUrl ?? podcast.imageUrl
  const waveform = await readWaveform(episode.id)
  return {
    podcast,
    episode: {
      ...episode,
      // Sanitised when saved; again here, as it's rendered as HTML.
      description: sanitizeDescription(episode.description),
    },
    isOwner: userId === ownerId,
    pageUrl: absolute(episodePath(podcast.slug, episode.slug)),
    // The episode's share page, which the Share button gives out.
    shareUrl: absolute(shortPath(episode.shortSlug)),
    embedUrl: absolute(embedPath(podcast.slug, episode.slug)),
    feedUrl: absolute(feedPath(podcast.slug)),
    audioUrl: absolute(episode.audioUrl!),
    previewImage: previewImage(artwork, absolute),
    // The smoother of the two shapes, as Mixcloud draws them.
    waveform: waveform?.rms ?? null,
  }
}
