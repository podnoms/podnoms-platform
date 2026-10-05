// How the sidebar orders the user's podcasts. The choice is kept in a cookie,
// so the server renders the list in that order to begin with.
import { createIsomorphicFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

export const podcastSorts = {
  'latest-episode': 'Latest episode',
  latest: 'Newest podcast',
  title: 'Title (A–Z)',
} as const
export type PodcastSort = keyof typeof podcastSorts

const cookieName = 'podcast-sort'
const isPodcastSort = (value: unknown): value is PodcastSort => typeof value === 'string' && value in podcastSorts

export const readPodcastSort = createIsomorphicFn()
  .server((): PodcastSort => {
    const value = getCookie(cookieName)
    return isPodcastSort(value) ? value : 'title'
  })
  .client((): PodcastSort => {
    const value = document.cookie.match(new RegExp(`(?:^|; )${cookieName}=([^;]*)`))?.[1]
    return isPodcastSort(value) ? value : 'title'
  })

export function savePodcastSort(sort: PodcastSort) {
  document.cookie = `${cookieName}=${sort}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
}

type Sortable = { title: string; createdAt: Date; latestEpisodeAt: Date | null }

const byTitle = (a: Sortable, b: Sortable) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })
const newestFirst = (a: Date | null, b: Date | null) => (b?.getTime() ?? -Infinity) - (a?.getTime() ?? -Infinity) || 0

// A sorted copy. Podcasts without episodes go last when sorting by them;
// ties go by title.
export function sortPodcasts<T extends Sortable>(podcasts: T[], sort: PodcastSort): T[] {
  const compare = {
    title: byTitle,
    latest: (a: T, b: T) => newestFirst(a.createdAt, b.createdAt) || byTitle(a, b),
    'latest-episode': (a: T, b: T) => newestFirst(a.latestEpisodeAt, b.latestEpisodeAt) || byTitle(a, b),
  }[sort]
  return [...podcasts].sort(compare)
}
