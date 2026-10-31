// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryHistory, createRootRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTagEpisodes, fetchTagPage } from '~/functions/tags'
import { Route } from '~/routes/tags.$tagSlug'

vi.mock('~/functions/tags', () => ({ fetchTagEpisodes: vi.fn(), fetchTagPage: vi.fn() }))
vi.mock('~/components/listener-episode-list', () => ({
  ListenerEpisodeList: ({ episodes }: { episodes: { id: string; title: string }[] }) => (
    <ul>{episodes.map((episode) => <li key={episode.id}>{episode.title}</li>)}</ul>
  ),
}))

type TaggedEpisode = Awaited<ReturnType<typeof fetchTagEpisodes>>[number]
function episode(id: string): TaggedEpisode {
  return {
    id, title: id, slug: id, shortSlug: id,
    description: null, audioUrl: '/audio.mp3', imageUrl: null, durationSeconds: 120, explicit: false,
    createdAt: new Date(), publishedAt: null, positionSeconds: null,
    likeCount: 0, liked: false, waveform: null, tags: [],
    show: { slug: 'show', title: 'Show', imageUrl: null, isOwner: false },
  }
}

const observers = new Set<IntersectionObserverCallback>()
class Observer {
  constructor(private callback: IntersectionObserverCallback) {}
  observe() { observers.add(this.callback) }
  disconnect() { observers.delete(this.callback) }
}

beforeEach(() => {
  vi.clearAllMocks()
  observers.clear()
  vi.stubGlobal('IntersectionObserver', Observer)
  vi.mocked(fetchTagPage).mockImplementation(async ({ data }) => ({
    tag: { id: 'tag-1', name: 'house', slug: data.tagSlug },
    episodes: [episode(`${data.sort}-first`)],
    total: 2,
  }))
  vi.mocked(fetchTagEpisodes).mockImplementation(async ({ data }) => [episode(`${data.sort}-next`)])
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function setup(path = '/tags/house') {
  const root = createRootRoute({ component: Outlet })
  const route = Route.update({
    id: '/tags/$tagSlug', path: '/tags/$tagSlug', getParentRoute: () => root,
  } as never)
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultPendingMinMs: 0,
  })
  await act(async () => {
    await router.load()
    render(<RouterProvider router={router} />)
  })
  await screen.findByRole('heading', { name: '#house' })
  return router
}

async function loadNextPage() {
  await act(async () => {
    for (const callback of observers) callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
  })
}

describe('tag browsing', () => {
  it('keeps sorting in the URL and starts pagination again when the sort changes', async () => {
    const router = await setup()
    expect(vi.mocked(fetchTagPage).mock.calls[0]?.[0].data).toEqual({ tagSlug: 'house', sort: 'newest' })
    await loadNextPage()
    await screen.findByText('newest-next')

    await userEvent.click(screen.getByRole('radio', { name: 'Popularity' }))
    await screen.findByText('popular-first')
    await waitFor(() => expect(screen.queryByText('newest-next')).toBeNull())
    expect(router.state.location.search).toMatchObject({ sort: 'popular' })
    await loadNextPage()
    await screen.findByText('popular-next')
    expect(vi.mocked(fetchTagEpisodes).mock.calls.at(-1)?.[0].data).toEqual({
      tagSlug: 'house', sort: 'popular', offset: 1, limit: 10,
    })
  })

  it('opens a shared popularity link with the matching ordering', async () => {
    await setup('/tags/house?sort=popular')
    expect(screen.getByRole('radio', { name: 'Popularity' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('popular-first')).toBeTruthy()
  })
})
