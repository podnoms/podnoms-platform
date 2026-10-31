// How the sidebar orders the user's shows. The choice is kept in a cookie,
// so the server renders the list in that order to begin with.
import { createIsomorphicFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

export const showSorts = {
  'latest-episode': 'Latest episode',
  latest: 'Newest show',
  title: 'Title (A–Z)',
} as const
export type ShowSort = keyof typeof showSorts

const cookieName = 'show-sort'
const isShowSort = (value: unknown): value is ShowSort => typeof value === 'string' && value in showSorts

export const readShowSort = createIsomorphicFn()
  .server((): ShowSort => {
    const value = getCookie(cookieName)
    return isShowSort(value) ? value : 'title'
  })
  .client((): ShowSort => {
    const value = document.cookie.match(new RegExp(`(?:^|; )${cookieName}=([^;]*)`))?.[1]
    return isShowSort(value) ? value : 'title'
  })

export function saveShowSort(sort: ShowSort) {
  document.cookie = `${cookieName}=${sort}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
}

type Sortable = { title: string; createdAt: Date; latestEpisodeAt: Date | null }

const byTitle = (a: Sortable, b: Sortable) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })
const newestFirst = (a: Date | null, b: Date | null) => (b?.getTime() ?? -Infinity) - (a?.getTime() ?? -Infinity) || 0

// A sorted copy. Shows without episodes go last when sorting by them;
// ties go by title.
export function sortShows<T extends Sortable>(shows: T[], sort: ShowSort): T[] {
  const compare = {
    title: byTitle,
    latest: (a: T, b: T) => newestFirst(a.createdAt, b.createdAt) || byTitle(a, b),
    'latest-episode': (a: T, b: T) => newestFirst(a.latestEpisodeAt, b.latestEpisodeAt) || byTitle(a, b),
  }[sort]
  return [...shows].sort(compare)
}
