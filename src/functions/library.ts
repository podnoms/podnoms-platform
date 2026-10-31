// Server functions for listeners: liking episodes, following shows, and the
// pages built from them (home, Likes, Following) and Explore, which anyone
// can see.
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { episodePageSize } from '~/lib/episode-pages'
import { followShowSchema, likeEpisodeSchema, listPageSchema } from '~/lib/library-schema'
import { getSession } from '~/server/auth.server'
import {
  countExploreShows,
  countLikedEpisodes,
  listContinueListening,
  listExploreShows,
  listFollowedShows,
  listFollowingEpisodes,
  listLatestEpisodes,
  listLikedEpisodes,
  listPopularEpisodes,
  setEpisodeLike,
  setShowFollow,
} from '~/server/library.server'
import { withWaveforms } from '~/server/waveforms.server'
import { withEpisodeTags } from '~/server/tags-store.server'

async function withListenerDetails<T extends { id: string }>(episodes: T[]) {
  return withWaveforms(await withEpisodeTags(episodes))
}

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

export const followShow = createServerFn({ method: 'POST' })
  .validator(followShowSchema)
  .handler(async ({ data }) => {
    const result = await setShowFollow(await requireUserId(), data.showId, data.following)
    if (!result) throw notFound()
    return result
  })

// The shows the signed-in user follows, for the sidebar.
export const fetchFollowedShows = createServerFn({ method: 'GET' }).handler(async () =>
  listFollowedShows(await requireUserId()),
)

// The signed-in home page for listeners: what they were part-way through,
// what's new from the shows they follow, and what they liked lately.
export const fetchListenerHome = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUserId()
  const [continueListening, newEpisodes, liked, popular] = await Promise.all([
    listContinueListening(userId).then(withListenerDetails),
    listFollowingEpisodes(userId, { offset: 0, limit: 6 }).then(withListenerDetails),
    listLikedEpisodes(userId, { offset: 0, limit: 4 }).then(withListenerDetails),
    listPopularEpisodes(userId, 4).then(withListenerDetails),
  ])
  return { continueListening, newEpisodes, liked, popular }
})

export const fetchLikes = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUserId()
  const [episodes, total] = await Promise.all([
    listLikedEpisodes(userId, firstPage).then(withListenerDetails),
    countLikedEpisodes(userId),
  ])
  return { episodes, total }
})

export const fetchMoreLikes = createServerFn({ method: 'GET' })
  .validator(listPageSchema)
  .handler(async ({ data }) => withListenerDetails(await listLikedEpisodes(await requireUserId(), data)))

export const fetchFollowing = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await requireUserId()
  const [shows, episodes] = await Promise.all([
    listFollowedShows(userId),
    listFollowingEpisodes(userId, firstPage).then(withListenerDetails),
  ])
  return { shows, episodes }
})

export const fetchMoreFollowingEpisodes = createServerFn({ method: 'GET' })
  .validator(listPageSchema)
  .handler(async ({ data }) => withListenerDetails(await listFollowingEpisodes(await requireUserId(), data)))

// How many shows Explore shows at first, and loads each time after.
export const exploreShowPageSize = 12

export const fetchExplore = createServerFn({ method: 'GET' }).handler(async () => {
  const userId = await viewerId()
  const [popular, shows, showCount, latest] = await Promise.all([
    listPopularEpisodes(userId).then(withListenerDetails),
    listExploreShows(userId, { offset: 0, limit: exploreShowPageSize }),
    countExploreShows(),
    listLatestEpisodes(userId, firstPage).then(withListenerDetails),
  ])
  return { popular, shows, showCount, latest }
})

// A few of the site's public shows, for the landing page to link to.
export const fetchLandingShows = createServerFn({ method: 'GET' }).handler(() =>
  listExploreShows(null, { offset: 0, limit: 8 }),
)

export const fetchMoreExploreShows = createServerFn({ method: 'GET' })
  .validator(listPageSchema)
  .handler(async ({ data }) => listExploreShows(await viewerId(), data))

export const fetchMoreLatestEpisodes = createServerFn({ method: 'GET' })
  .validator(listPageSchema)
  .handler(async ({ data }) => withListenerDetails(await listLatestEpisodes(await viewerId(), data)))
