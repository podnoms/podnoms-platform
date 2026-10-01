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
import { createEpisode, deleteEpisode, listEpisodes, retryEpisode, savePlaybackPosition, updateEpisode } from '~/server/episodes.server'
import { createPodcast, getPodcastBySlug, listPodcasts, updatePodcast } from '~/server/podcasts.server'

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
    const episodes = await listEpisodes(userId, podcast.id)
    return {
      ...podcast,
      feedUrl: new URL(feedPath(podcast.slug), publicUrl(getRequest())).toString(),
      episodes: episodes.map((episode) => ({ ...episode, progress: getEpisodeProgress(episode.id) })),
    }
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
