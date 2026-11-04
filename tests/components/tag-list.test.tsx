// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TagList } from '~/components/tag-list'
import { isCustomDomain } from '~/lib/current-domain'

vi.mock('~/lib/current-domain', () => ({ isCustomDomain: vi.fn(() => false) }))

beforeEach(() => vi.mocked(isCustomDomain).mockReturnValue(false))
afterEach(cleanup)

async function renderTags() {
  const root = createRootRoute({
    component: () => <TagList tags={[{ id: 'tag-1', name: 'deep house', slug: 'deep-house' }]} />,
  })
  const tag = createRoute({ getParentRoute: () => root, path: '/tags/$tagSlug' })
  const router = createRouter({
    routeTree: root.addChildren([tag]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await act(async () => {
    await router.load()
    render(<RouterProvider router={router} />)
  })
}

describe('TagList', () => {
  it('links to the shared tag page on the site', async () => {
    await renderTags()
    const link = await screen.findByRole('link', { name: '#deep house' })
    expect(link.getAttribute('href')).toBe('/tags/deep-house?sort=newest')
  })

  it("isn't shown on a show's own domain", async () => {
    vi.mocked(isCustomDomain).mockReturnValue(true)
    await renderTags()
    expect(screen.queryByText('#deep house')).toBeNull()
  })
})
