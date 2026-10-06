// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiscordLink } from '~/components/discord-link'

const discordUrl = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@tanstack/react-router', () => ({
  useLoaderData: ({ select }: { select: (data: unknown) => unknown }) =>
    select({ siteLinks: { kofiUrl: null, bitcoinAddress: null, discordUrl: discordUrl.value } }),
}))

afterEach(cleanup)

describe('DiscordLink', () => {
  it('renders nothing without DISCORD_SERVER', () => {
    discordUrl.value = null
    expect(render(<DiscordLink />).container.innerHTML).toBe('')
  })

  it('links to the Discord server in a new tab', () => {
    discordUrl.value = 'https://discord.gg/podnoms'
    render(<DiscordLink />)
    const link = screen.getByRole('link', { name: 'Join us on Discord' })
    expect(link.getAttribute('href')).toBe('https://discord.gg/podnoms')
    expect(link.getAttribute('target')).toBe('_blank')
  })
})
