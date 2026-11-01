// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TagList } from '~/components/tag-list'
import { currentDomainSlug } from '~/lib/current-domain'

vi.mock('~/lib/current-domain', () => ({ currentDomainSlug: vi.fn(() => null) }))

beforeEach(() => vi.mocked(currentDomainSlug).mockReturnValue(null))
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
  return screen.findByText('#deep house')
}

describe('TagList', () => {
  it('links to the shared tag page on the site', async () => {
    const link = await renderTags()
    expect(link.getAttribute('href')).toBe('/tags/deep-house?sort=newest')
  })

  it("doesn't link anywhere on a show's own domain", async () => {
    vi.mocked(currentDomainSlug).mockReturnValue('my-show')
    await renderTags()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
