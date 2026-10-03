// Infinite scrolling for a show page's episode list. The page's loader gives
// the first page; more are fetched when the end of the list scrolls into view.
import { useCallback, useEffect, useRef, useState } from 'react'
import { episodePageSize } from '~/lib/episode-pages'

export function useEpisodePages<T extends { id: string }>({
  podcastSlug,
  first,
  total,
  fetchMore,
}: {
  // Moving to another podcast starts its list afresh.
  podcastSlug: string
  // The first page, from the loader. When the page reloads (after an edit, or
  // as episodes finish processing) it's replaced, and the episodes loaded
  // after it are fetched again so they don't go stale.
  first: T[]
  // How many episodes there are in all.
  total: number
  fetchMore: (offset: number, limit: number) => Promise<T[]>
}) {
  const [more, setMore] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  // A page came back short: there's no more, whatever `total` says.
  const [done, setDone] = useState(false)
  // Bumped when the first page is replaced, so answers to older requests are dropped.
  const generation = useRef(0)
  const latestFetch = useRef(fetchMore)
  latestFetch.current = fetchMore

  // Episodes added since the first page loaded push others down a page, so
  // one can come back twice.
  const firstIds = new Set(first.map((episode) => episode.id))
  const episodes = [...first, ...more.filter((episode) => !firstIds.has(episode.id))]
  const hasMore = !done && episodes.length < total

  const load = useCallback(
    async (offset: number, limit: number, replace: boolean) => {
      const current = ++generation.current
      setLoading(true)
      setFailed(false)
      try {
        const page = await latestFetch.current(offset, limit)
        if (current !== generation.current) return
        setMore((loaded) => (replace ? page : [...loaded, ...page]))
        setDone(page.length < limit)
      } catch {
        if (current === generation.current) setFailed(true)
      } finally {
        if (current === generation.current) setLoading(false)
      }
    },
    [],
  )

  const moreCount = useRef(0)
  moreCount.current = more.length
  const previous = useRef({ first, podcastSlug })
  useEffect(() => {
    if (previous.current.first === first) return
    const samePodcast = previous.current.podcastSlug === podcastSlug
    previous.current = { first, podcastSlug }
    if (samePodcast && moreCount.current > 0) {
      void load(first.length, moreCount.current, true)
      return
    }
    generation.current++
    setMore([])
    setLoading(false)
    setFailed(false)
    setDone(false)
  }, [first, podcastSlug, load])

  // Loads the next page when the sentinel (put after the list) comes within
  // a screen's height of view. Observing afresh after each page means a short
  // page that leaves it in view loads the next straight away.
  const sentinel = useRef<HTMLDivElement>(null)
  const canLoad = hasMore && !loading && !failed
  useEffect(() => {
    const element = sentinel.current
    if (!element || !canLoad) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void load(first.length + moreCount.current, episodePageSize, false)
      },
      { rootMargin: '100% 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [canLoad, episodes.length, first.length, load])

  const retry = () => void load(first.length + more.length, episodePageSize, false)

  return { episodes, hasMore, loading, failed, retry, sentinel }
}
