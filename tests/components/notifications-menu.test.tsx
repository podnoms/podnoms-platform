// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationsMenu } from '~/components/notifications-menu'
import { fetchInbox, fetchUnreadCount, markInboxRead } from '~/functions/inbox'

const navigate = vi.fn(() => Promise.resolve())
const route = vi.hoisted(() => ({ session: { user: { name: 'Ann' } } as object | null }))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ session: route.session }),
  useRouter: () => ({ navigate }),
}))
vi.mock('~/functions/inbox', () => ({ fetchInbox: vi.fn(), fetchUnreadCount: vi.fn(), markInboxRead: vi.fn() }))

beforeAll(() => {
  // Used by Radix, missing from happy-dom.
  Element.prototype.scrollIntoView ??= () => {}
})
beforeEach(() => {
  route.session = { user: { name: 'Ann' } }
  navigate.mockClear()
  vi.mocked(fetchUnreadCount).mockReset().mockResolvedValue(2)
  vi.mocked(markInboxRead).mockReset().mockResolvedValue(undefined)
  vi.mocked(fetchInbox)
    .mockReset()
    .mockResolvedValue({
      unread: 2,
      items: [
        {
          id: 'n1',
          kind: 'mention',
          title: 'Bob mentioned you',
          body: 'Hey @ann',
          url: '/show/episodes/one#comment-1',
          image: null,
          read: false,
          createdAt: new Date(),
        },
        {
          id: 'n2',
          kind: 'live',
          title: 'The Show is live',
          body: 'Q&A night',
          url: '/live/the-show',
          image: null,
          read: true,
          createdAt: new Date(),
        },
      ],
    })
})
afterEach(cleanup)

describe('NotificationsMenu', () => {
  it("isn't there for signed-out visitors", () => {
    route.session = null
    render(<NotificationsMenu />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows how many are unread, and opening it lists them and marks them read', async () => {
    render(<NotificationsMenu />)
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' })
    fireEvent.click(bell)
    expect(await screen.findByText('Bob mentioned you')).toBeTruthy()
    expect(screen.getByText('Q&A night')).toBeTruthy()
    // Still marked until it's next opened.
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1)
    await waitFor(() => expect(markInboxRead).toHaveBeenCalledWith({ data: {} }))
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy()
  })

  it('goes where a notification leads', async () => {
    render(<NotificationsMenu />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }))
    fireEvent.click(await screen.findByText('The Show is live'))
    expect(navigate).toHaveBeenCalledWith({ href: '/live/the-show' })
  })

  it('says when there is nothing yet', async () => {
    vi.mocked(fetchUnreadCount).mockResolvedValue(0)
    vi.mocked(fetchInbox).mockResolvedValue({ unread: 0, items: [] })
    render(<NotificationsMenu />)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText('Nothing yet')).toBeTruthy()
    expect(markInboxRead).not.toHaveBeenCalled()
  })
})
