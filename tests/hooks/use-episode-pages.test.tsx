// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEpisodePages } from '~/hooks/use-episode-pages'

// happy-dom has no IntersectionObserver; this one reports the sentinel in
// view whenever `inView` is set, as the real one does when it starts observing.
let inView = false
const observers = new Set<FakeObserver>()
class FakeObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe() {
    observers.add(this)
    if (inView) this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never)
  }
  disconnect() {
    observers.delete(this)
  }
}

const episode = (n: number) => ({ id: `e${n}` })
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => episode(from + i))
const fakeFetch = (total: number) =>
  vi.fn(async (offset: number, limit: number) => range(offset, Math.max(0, Math.min(limit, total - offset))))

beforeEach(() => {
  inView = false
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// `prepare` sets up fetchMore before the first render, which may already call it.
function setup(total: number, prepare?: (fetchMore: ReturnType<typeof fakeFetch>) => void, first = range(0, 10)) {
  const fetchMore = fakeFetch(total)
  prepare?.(fetchMore)
  const view = renderHook((props: { first: { id: string }[]; podcastSlug: string }) => {
    const pages = useEpisodePages({ ...props, total, fetchMore })
    // Stand in for the element the page puts after the list.
    pages.sentinel.current ??= document.createElement('div')
    return pages
  }, { initialProps: { first, podcastSlug: 'show' } })
  return { ...view, fetchMore }
}

describe('useEpisodePages', () => {
  it('starts with the first page and fetches nothing until the end is in view', () => {
    const { result, fetchMore } = setup(25)
    expect(result.current.episodes).toHaveLength(10)
    expect(result.current.hasMore).toBe(true)
    expect(fetchMore).not.toHaveBeenCalled()
  })

  it('loads pages while the end of the list is in view, until there are no more', async () => {
    inView = true
    const { result, fetchMore } = setup(25)
    await waitFor(() => expect(result.current.episodes).toHaveLength(25))
    expect(fetchMore.mock.calls).toEqual([
      [10, 10],
      [20, 10],
    ])
    expect(result.current.hasMore).toBe(false)
  })

  it('stops when a page comes back short', async () => {
    inView = true
    const { result, fetchMore } = setup(30, (fetchMore) => fetchMore.mockResolvedValueOnce(range(10, 3)))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.episodes).toHaveLength(13)
    expect(result.current.hasMore).toBe(false)
    expect(fetchMore).toHaveBeenCalledTimes(1)
  })

  it('drops episodes that come back twice', async () => {
    inView = true
    const { result, fetchMore } = setup(20, (fetchMore) => fetchMore.mockResolvedValueOnce(range(9, 10)))
    await waitFor(() => expect(fetchMore).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(new Set(result.current.episodes.map((e) => e.id)).size).toBe(result.current.episodes.length)
  })

  it('refetches the episodes loaded after the first page when the page reloads', async () => {
    inView = true
    const { result, rerender, fetchMore } = setup(15)
    await waitFor(() => expect(result.current.episodes).toHaveLength(15))
    inView = false
    rerender({ first: range(0, 10), podcastSlug: 'show' })
    await waitFor(() => expect(fetchMore).toHaveBeenLastCalledWith(10, 5))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.episodes).toHaveLength(15)
  })

  it('starts afresh on another podcast', async () => {
    inView = true
    const { result, rerender, fetchMore } = setup(15)
    await waitFor(() => expect(result.current.episodes).toHaveLength(15))
    inView = false
    fetchMore.mockClear()
    rerender({ first: range(100, 10), podcastSlug: 'other' })
    await waitFor(() => expect(result.current.episodes.map((e) => e.id)).toEqual(range(100, 10).map((e) => e.id)))
    expect(fetchMore).not.toHaveBeenCalled()
  })

  it('offers a retry when loading fails', async () => {
    inView = true
    const { result } = setup(15, (fetchMore) => fetchMore.mockRejectedValueOnce(new Error('offline')))
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.hasMore).toBe(true)
    await act(async () => result.current.retry())
    await waitFor(() => expect(result.current.episodes).toHaveLength(15))
    expect(result.current.failed).toBe(false)
  })
})
