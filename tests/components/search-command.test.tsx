// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchCommand } from '~/components/search-command'
import { searchMyLibrary } from '~/functions/search'

const navigate = vi.fn(() => Promise.resolve())
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useLoaderData: () => ({ podcasts: [{ id: 'p1', title: 'Deep House Sessions', slug: 'deep-house', imageUrl: null }] }),
}))
vi.mock('~/functions/search', () => ({ searchMyLibrary: vi.fn() }))

beforeAll(() => {
  // Used by cmdk and Radix, missing from happy-dom.
  Element.prototype.scrollIntoView ??= () => {}
})
beforeEach(() => {
  navigate.mockClear()
  vi.mocked(searchMyLibrary).mockReset()
})
afterEach(cleanup)

const results = {
  podcasts: [{ id: 'p1', title: 'Deep House Sessions', slug: 'deep-house', imageUrl: null, excerpt: null }],
  episodes: [
    {
      id: 'e1',
      title: 'Late Night Mix',
      slug: 'late-night',
      imageUrl: '/images/a.jpg',
      podcastTitle: 'Deep House Sessions',
      podcastSlug: 'deep-house',
      excerpt: '…recorded at a house party…',
    },
  ],
}

function openPalette() {
  render(<SearchCommand />)
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  return screen.getByPlaceholderText('Search podcasts and episodes…')
}

describe('SearchCommand', () => {
  it('opens from the button, listing the podcasts before anything is typed', async () => {
    render(<SearchCommand />)
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(screen.getByText('Your podcasts')).toBeTruthy()
    expect(screen.getByText('Deep House Sessions')).toBeTruthy()
    expect(searchMyLibrary).not.toHaveBeenCalled()
  })

  it('opens with Ctrl+K', () => {
    expect(openPalette()).toBeTruthy()
  })

  it('searches once typing pauses and groups the results by type', async () => {
    vi.mocked(searchMyLibrary).mockResolvedValue(results as never)
    await userEvent.type(openPalette(), 'house')

    await screen.findByText('Late Night Mix')
    expect(searchMyLibrary).toHaveBeenCalledTimes(1)
    expect(searchMyLibrary).toHaveBeenCalledWith({ data: { query: 'house' } })
    expect(screen.getByText('Podcasts')).toBeTruthy()
    expect(screen.getByText('Episodes')).toBeTruthy()
    expect(screen.getByText('…recorded at a house party…')).toBeTruthy()
    expect(screen.queryByText('Your podcasts')).toBeNull()
  })

  it('opens the chosen episode and closes', async () => {
    vi.mocked(searchMyLibrary).mockResolvedValue(results as never)
    await userEvent.type(openPalette(), 'late')
    await userEvent.click(await screen.findByText('Late Night Mix'))

    expect(navigate).toHaveBeenCalledWith({
      to: '/podcasts/$slug/episodes/$episodeSlug/manage',
      params: { slug: 'deep-house', episodeSlug: 'late-night' },
    })
    await waitFor(() => expect(screen.queryByPlaceholderText('Search podcasts and episodes…')).toBeNull())
  })

  it('opens the chosen podcast', async () => {
    vi.mocked(searchMyLibrary).mockResolvedValue(results as never)
    await userEvent.type(openPalette(), 'deep')
    await screen.findByText('Late Night Mix')
    await userEvent.click(screen.getAllByText('Deep House Sessions')[0]!)

    expect(navigate).toHaveBeenCalledWith({ to: '/podcasts/$slug/manage', params: { slug: 'deep-house' } })
  })

  it('says when nothing matches', async () => {
    vi.mocked(searchMyLibrary).mockResolvedValue({ podcasts: [], episodes: [] })
    await userEvent.type(openPalette(), 'zzz')
    expect(await screen.findByText('No podcasts or episodes match “zzz”.')).toBeTruthy()
  })

  it('says when searching fails', async () => {
    vi.mocked(searchMyLibrary).mockRejectedValue(new Error('offline'))
    await userEvent.type(openPalette(), 'x')
    expect(await screen.findByText('Searching failed. Please try again.')).toBeTruthy()
  })
})
