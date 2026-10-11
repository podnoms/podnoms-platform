// Server functions for listeners: liking episodes, following podcasts, and the
// pages built from them (home, Likes, Following) and Explore, which anyone
// can see.
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { episodePageSize } from '~/lib/episode-pages'
import { followPodcastSchema, likeEpisodeSchema, listPageSchema } from '~/lib/library-schema'
import { getSession } from '~/server/auth.server'
import {
  countExplorePodcasts,
  countLikedEpisodes,
  listContinueListening,
  listExplorePodcasts,
  listFollowedPodcasts,
  listFollowingEpisodes,
  listLatestEpisodes,
  listLikedEpisodes,
  listPopularEpisodes,
  setEpisodeLike,
  setPodcastFollow,
} from '~/server/library.server'
import { withWaveforms } from '~/server/waveforms.server'

async function viewerId() {
  const session = await getSession(getRequest())
  return session?.user?.id ?? null
}

async function requireUserId() {
  const userId = await viewerId()
  if (!userId) throw new Error('You need to be signed in')
  return userId
}

const firstPage = { offset: 0, limit: episodePageSize }

export const likeEpisode = createServerFn({ method: 'POST' })
  .validator(likeEpisodeSchema)
  .handler(async ({ data }) => {
    const result = await setEpisodeLike(await requireUserId(), data.episodeId, data.liked)
    if (!result) throw notFound()
    return result
  })

export const followPodcast = createServerFn({ method: 'POST' })
  .validator(followPodcastSchema)
  .handler(async ({ data }) => {
    const result = await setPodcastFollow(await requireUserId(), data.podcastId, data.following)
    if (!result) throw notFound()
    return result
  })

// The podcasts the signed-in user follows, for the sidebar.
export const fetchFollowedPodcasts = createServerFn({ method: 'GET' }).handler(async () =>
  listFollowedPodcasts(await requireUserId()),
)

// The signed-in home page for listeners: what they were part-way through,
// what's new from the podcasts they follow, and what they liked lately.
export const fetchListenerHome = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUserId()
  const [continueListening, newEpisodes, liked, popular] = await Promise.all([
    listContinueListening(userId).then(withWaveforms),
    listFollowingEpisodes(userId, { offset: 0, limit: 6 }).then(withWaveforms),
    listLikedEpisodes(userId, { offset: 0, limit: 4 }).then(withWaveforms),
    listPopularEpisodes(userId, 4).then(withWaveforms),
  ])
  return { continueListening, newEpisodes, liked, popular }
})

export const fetchLikes = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUserId()
  const [episodes, total] = await Promise.all([
    listLikedEpisodes(userId, firstPage).then(withWaveforms),
    countLikedEpisodes(userId),
  ])
  return { episodes, total }
})

export const fetchMoreLikes = createServerFn({ method: 'GET' })
  .validator(listPageSchema)
  .handler(async ({ data }) => withWaveforms(await listLikedEpisodes(await requireUserId(), data)))

export const fetchFollowing = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUserId()
  const [podcasts, episodes] = await Promise.all([
    listFollowedPodcasts(userId),
    listFollowingEpisodes(userId, firstPage).then(withWaveforms),
  ])
  return { podcasts, episodes }
})

export const fetchMoreFollowingEpisodes = createServerFn({ method: 'GET' })
  .validator(listPageSchema)
  .handler(async ({ data }) => withWaveforms(await listFollowingEpisodes(await requireUserId(), data)))

// How many shows Explore shows at first, and loads each time after.
export const explorePodcastPageSize = 12

export const fetchExplore = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await viewerId()
  const [popular, podcasts, podcastCount, latest] = await Promise.all([
    listPopularEpisodes(userId).then(withWaveforms),
    listExplorePodcasts(userId, { offset: 0, limit: explorePodcastPageSize }),
    countExplorePodcasts(),
    listLatestEpisodes(userId, firstPage).then(withWaveforms),
  ])
  return { popular, podcasts, podcastCount, latest }
})

export const fetchMoreExplorePodcasts = createServerFn({ method: 'GET' })
  .validator(listPageSchema)
  .handler(async ({ data }) => listExplorePodcasts(await viewerId(), data))

export const fetchMoreLatestEpisodes = createServerFn({ method: 'GET' })
  .validator(listPageSchema)
  .handler(async ({ data }) => withWaveforms(await listLatestEpisodes(await viewerId(), data)))
