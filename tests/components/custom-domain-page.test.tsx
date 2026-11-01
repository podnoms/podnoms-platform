// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddToPlaylistButton } from '~/components/add-to-playlist-button'
import { AuthorLink } from '~/components/author-link'
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
  const profile = createRoute({ getParentRoute: () => root, path: '/u/$slug' })
  const router = createRouter({
    routeTree: root.addChildren([profile]),
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

  it("links to the author's profile", async () => {
    await renderPage(<AuthorLink author="Sam" slug="sam" />)
    expect(screen.getByRole('link', { name: 'Sam' }).getAttribute('href')).toBe('/u/sam')
  })
})

describe("on a show's own domain", () => {
  beforeEach(() => vi.mocked(currentDomainSlug).mockReturnValue('my-show'))

  it('leaves out what needs an account', async () => {
    await renderPage(accountButtons)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it("names the author without linking to the site", async () => {
    await renderPage(<AuthorLink author="Sam" slug="sam" />)
    expect(screen.getByText('by Sam')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
