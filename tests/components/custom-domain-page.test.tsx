// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddToPlaylistButton } from '~/components/add-to-playlist-button'
import { FollowButton } from '~/components/follow-button'
import { LikeButton } from '~/components/like-button'
import { currentDomainSlug } from '~/lib/current-domain'

vi.mock('~/lib/current-domain', () => ({ currentDomainSlug: vi.fn(() => null) }))
vi.mock('~/functions/library', () => ({ followShow: vi.fn(), likeEpisode: vi.fn() }))
vi.mock('~/functions/playlists', () => ({
  addPlaylistEpisode: vi.fn(),
  fetchMyPlaylists: vi.fn(),
  removePlaylistEpisode: vi.fn(),
  savePlaylist: vi.fn(),
}))

beforeEach(() => vi.mocked(currentDomainSlug).mockReturnValue(null))
afterEach(cleanup)

async function renderPage(page: ReactNode) {
  const root = createRootRoute({ beforeLoad: () => ({ session: null }), component: () => page })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await act(async () => {
    await router.load()
    render(<RouterProvider router={router} />)
  })
}

const accountButtons = (
  <>
    <FollowButton showId="show-1" following={false} />
    <LikeButton episodeId="episode-1" liked={false} likeCount={0} />
    <AddToPlaylistButton episodeId="episode-1" />
  </>
)

describe('on the site', () => {
  it('offers what needs an account', async () => {
    await renderPage(accountButtons)
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })
})

describe("on a show's own domain", () => {
  beforeEach(() => vi.mocked(currentDomainSlug).mockReturnValue('my-show'))

  it('leaves out what needs an account', async () => {
    await renderPage(accountButtons)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
