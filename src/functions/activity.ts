import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { activityQuerySchema } from '~/lib/activity-schema'
import { getSession } from '~/server/auth.server'
import { summariseActivity } from '~/server/activity.server'
import { getEpisode } from '~/server/episodes.server'
import { getShowBySlug } from '~/server/shows.server'

// Stats for one of the user's shows, or one of its episodes.
export const fetchMyActivity = createServerFn({ method: 'GET' })
  .validator(activityQuerySchema)
  .handler(async ({ data }) => {
    const session = await getSession(getRequest())
    if (!session?.user?.id) throw new Error('You need to be signed in')
    if (data.episodeSlug) {
      const found = await getEpisode(session.user.id, data.slug, data.episodeSlug)
      if (!found) throw notFound()
      return summariseActivity({ showId: found.show.id, episodeId: found.episode.id, days: data.days })
    }
    const show = await getShowBySlug(session.user.id, data.slug)
    if (!show) throw notFound()
    return summariseActivity({ showId: show.id, days: data.days })
  })
