import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { activityQuerySchema } from '~/lib/activity-schema'
import { getSession } from '~/server/auth.server'
import { summariseActivity } from '~/server/activity.server'
import { getEpisode } from '~/server/episodes.server'
import { getPodcastBySlug } from '~/server/podcasts.server'

// Stats for one of the user's podcasts, or one of its episodes.
export const fetchMyActivity = createServerFn({ method: 'GET' })
  .validator(activityQuerySchema)
  .handler(async ({ data }) => {
    const session = await getSession(getRequest())
    if (!session?.user?.id) throw new Error('You need to be signed in')
    if (data.episodeSlug) {
      const found = await getEpisode(session.user.id, data.slug, data.episodeSlug)
      if (!found) throw notFound()
      return summariseActivity({ podcastId: found.podcast.id, episodeId: found.episode.id, days: data.days })
    }
    const podcast = await getPodcastBySlug(session.user.id, data.slug)
    if (!podcast) throw notFound()
    return summariseActivity({ podcastId: podcast.id, days: data.days })
  })
