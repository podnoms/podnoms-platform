import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { newEpisodeSchema } from '~/lib/episode-schema'
import { newPodcastSchema } from '~/lib/podcast-schema'
import { getSession } from '~/server/auth.server'
import { createEpisode, listEpisodes } from '~/server/episodes.server'
import { createPodcast, getPodcastBySlug, listPodcasts } from '~/server/podcasts.server'

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
    const podcast = await getPodcastBySlug(await requireUserId(), data.slug)
    if (!podcast) throw notFound()
    return { ...podcast, episodes: await listEpisodes(podcast.id) }
  })

export const createMyPodcast = createServerFn({ method: 'POST' })
  .validator(newPodcastSchema)
  .handler(async ({ data }) => createPodcast(await requireUserId(), data))

export const createMyEpisode = createServerFn({ method: 'POST' })
  .validator(newEpisodeSchema)
  .handler(async ({ data }) => {
    const episode = await createEpisode(await requireUserId(), data)
    if (!episode) throw notFound()
    return episode
  })
