// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DonateMenu } from '~/components/donate-menu'

const donations = vi.hoisted(() => ({ value: { kofiUrl: null as string | null, bitcoinAddress: null as string | null } }))
vi.mock('@tanstack/react-router', () => ({
  useLoaderData: ({ select }: { select: (data: unknown) => unknown }) => select({ siteLinks: donations.value }),
}))

afterEach(cleanup)

const address = 'bc1qexampleaddress0000000000000000000000'

async function openMenu(links: typeof donations.value) {
  donations.value = links
  const user = userEvent.setup()
  render(<DonateMenu />)
  await user.click(screen.getByRole('button', { name: 'Donate' }))
  return user
}

describe('DonateMenu', () => {
  it('renders nothing without donation links', () => {
    donations.value = { kofiUrl: null, bitcoinAddress: null }
    const { container } = render(<DonateMenu />)
    expect(container.innerHTML).toBe('')
  })

  it('links to Ko-fi in a new tab', async () => {
    await openMenu({ kofiUrl: 'https://ko-fi.com/podnoms', bitcoinAddress: null })
    const link = screen.getByRole('menuitem', { name: /Ko-fi/ })
    expect(link.getAttribute('href')).toBe('https://ko-fi.com/podnoms')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.queryByText('Bitcoin')).toBeNull()
  })

  it('shows the Bitcoin address and copies it', async () => {
    const user = await openMenu({ kofiUrl: null, bitcoinAddress: address })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    screen.getByText(address)
    await user.click(screen.getByRole('menuitem', { name: 'Copy address' }))
    expect(writeText).toHaveBeenCalledWith(address)
    await waitFor(() => screen.getByRole('menuitem', { name: 'Copied' }))
  })
})
