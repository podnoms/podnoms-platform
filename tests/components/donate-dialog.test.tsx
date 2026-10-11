// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DonateDialog } from '~/components/donate-dialog'

const donations = vi.hoisted(() => ({ value: { kofiUrl: null as string | null, bitcoinAddress: null as string | null } }))
vi.mock('@tanstack/react-router', () => ({
  useLoaderData: ({ select }: { select: (data: unknown) => unknown }) => select({ siteLinks: donations.value }),
}))

afterEach(cleanup)

const address = 'bc1qexampleaddress0000000000000000000000'

async function openDialog(links: typeof donations.value) {
  donations.value = links
  const user = userEvent.setup()
  render(<DonateDialog />)
  await user.click(screen.getByRole('button', { name: 'Donate' }))
  return user
}

describe('DonateDialog', () => {
  it('renders nothing without donation links', () => {
    donations.value = { kofiUrl: null, bitcoinAddress: null }
    const { container } = render(<DonateDialog />)
    expect(container.innerHTML).toBe('')
  })

  it('explains why donations help', async () => {
    await openDialog({ kofiUrl: 'https://ko-fi.com/podnoms', bitcoinAddress: null })
    const dialog = screen.getByRole('dialog', { name: 'Support PodNoms' })
    expect(dialog.textContent).toMatch(/hosting and serving this much audio/)
  })

  it('links to Ko-fi in a new tab', async () => {
    await openDialog({ kofiUrl: 'https://ko-fi.com/podnoms', bitcoinAddress: null })
    const link = screen.getByRole('link', { name: /Ko-fi/ })
    expect(link.getAttribute('href')).toBe('https://ko-fi.com/podnoms')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.queryByText('Bitcoin')).toBeNull()
  })

  it('shows the Bitcoin address and copies it', async () => {
    const user = await openDialog({ kofiUrl: null, bitcoinAddress: address })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    screen.getByText(address)
    await user.click(screen.getByRole('button', { name: 'Copy address' }))
    expect(writeText).toHaveBeenCalledWith(address)
    await waitFor(() => screen.getByRole('button', { name: 'Copied' }))
  })
})
