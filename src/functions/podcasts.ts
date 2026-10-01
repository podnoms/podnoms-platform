import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { editEpisodeSchema, newEpisodeSchema } from '~/lib/episode-schema'
import { editPodcastSchema, newPodcastSchema } from '~/lib/podcast-schema'
import { getSession, publicUrl } from '~/server/auth.server'
import { getEpisodeProgress, resumeUnfinishedEpisodes } from '~/server/episode-processor.server'
import { feedPath } from '~/server/feed.server'
import { localiseRemoteImages } from '~/server/images.server'
import { createEpisode, deleteEpisode, getEpisode, getEpisodeSlug, listEpisodes, retryEpisode, savePlaybackPosition, updateEpisode } from '~/server/episodes.server'
import { createPodcast, getPodcastBySlug, listPodcasts, updatePodcast } from '~/server/podcasts.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { backfillWaveforms, readWaveform } from '~/server/waveforms.server'

async function requireUserId() {
  const session = await getSession(getRequest())
  if (!session?.user?.id) throw new Error('You need to be signed in')
  return session.user.id
}

// The signed-in user's podcasts, for the sidebar and home page.
export const fetchMyPodcasts = createServerFn({ method: 'GET' }).handler(async () =>
  listPodcasts(await requireUserId()),
)

export const fetchMyPodcast = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const podcast = await getPodcastBySlug(userId, data.slug)
    if (!podcast) throw notFound()
    void resumeUnfinishedEpisodes()
    void localiseRemoteImages()
    void backfillWaveforms()
    const episodes = await listEpisodes(userId, podcast.id)
    return {
      ...podcast,
      feedUrl: new URL(feedPath(podcast.slug), publicUrl(getRequest())).toString(),
      episodes: episodes.map((episode) => ({ ...episode, progress: getEpisodeProgress(episode.id) })),
    }
  })

// An episode's page: the episode, its podcast and its waveform (null until made).
export const fetchMyEpisode = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string(), episodeSlug: z.string() }))
  .handler(async ({ data }) => {
    const found = await getEpisode(await requireUserId(), data.slug, data.episodeSlug)
    if (!found) throw notFound()
    const { episode, podcast } = found
    const waveform = episode.status === 'ready' ? await readWaveform(episode.id) : null
    return {
      podcast,
      episode: {
        ...episode,
        // Sanitised when saved; again here, as it's rendered as HTML.
        description: sanitizeDescription(episode.description),
        progress: getEpisodeProgress(episode.id),
      },
      // The smoother of the two shapes, as Mixcloud draws them.
      waveform: waveform?.rms ?? null,
    }
  })

// An episode's current slug, which changes once when a link's title is fetched.
export const fetchMyEpisodeSlug = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const slug = await getEpisodeSlug(await requireUserId(), data.id)
    if (!slug) throw notFound()
    return slug
  })

export const createMyPodcast = createServerFn({ method: 'POST' })
  .validator(newPodcastSchema)
  .handler(async ({ data }) => createPodcast(await requireUserId(), data))

export const updateMyPodcast = createServerFn({ method: 'POST' })
  .validator(editPodcastSchema)
  .handler(async ({ data }) => {
    if (!(await updatePodcast(await requireUserId(), data))) throw notFound()
  })

export const createMyEpisode = createServerFn({ method: 'POST' })
  .validator(newEpisodeSchema)
  .handler(async ({ data }) => {
    const episode = await createEpisode(await requireUserId(), data)
    if (!episode) throw notFound()
    return episode
  })

export const deleteMyEpisode = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    if (!(await deleteEpisode(await requireUserId(), data.id))) throw notFound()
  })

export const updateMyEpisode = createServerFn({ method: 'POST' })
  .validator(editEpisodeSchema)
  .handler(async ({ data }) => {
    if (!(await updateEpisode(await requireUserId(), data))) throw notFound()
  })

export const retryMyEpisode = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    if (!(await retryEpisode(await requireUserId(), data.id))) throw notFound()
  })

export const saveMyPlaybackPosition = createServerFn({ method: 'POST' })
  .validator(z.object({ episodeId: z.string(), seconds: z.number().min(0) }))
  .handler(async ({ data }) => {
    if (!(await savePlaybackPosition(await requireUserId(), data.episodeId, data.seconds))) throw notFound()
  })
