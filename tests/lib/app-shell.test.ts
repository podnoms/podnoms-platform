import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inAppShell, showThemeHead } from '~/lib/app-shell'
import { isCustomDomain } from '~/lib/current-domain'
import { themeHead } from '~/lib/theme-css'

vi.mock('~/lib/current-domain', () => ({ isCustomDomain: vi.fn(() => false) }))

beforeEach(() => vi.mocked(isCustomDomain).mockReturnValue(false))

describe('inAppShell', () => {
  it('gives signed-in users the shell on every page, public ones too', () => {
    expect(inAppShell({ signedIn: true, publicPage: false, preview: false })).toBe(true)
    expect(inAppShell({ signedIn: true, publicPage: true, preview: false })).toBe(true)
  })

  it('never gives it to visitors', () => {
    expect(inAppShell({ signedIn: false, publicPage: true, preview: false })).toBe(false)
    expect(inAppShell({ signedIn: false, publicPage: false, preview: false })).toBe(false)
  })

  it("leaves it off in the visitor's view", () => {
    expect(inAppShell({ signedIn: true, publicPage: true, preview: true })).toBe(false)
  })

  it("leaves it off public pages on a show's own domain", () => {
    vi.mocked(isCustomDomain).mockReturnValue(true)
    expect(inAppShell({ signedIn: true, publicPage: true, preview: false })).toBe(false)
  })
})

describe('showThemeHead', () => {
  const theme = { css: 'html:root:root{--radius:0}', fonts: ['Inter'] }
  const themed = themeHead(theme)
  const none = { links: [], styles: [] }
  const matches = (root: { context?: unknown; search?: unknown }) => [
    { routeId: '__root__', ...root },
    { routeId: '/$user_/$show', context: {}, search: {} },
  ]

  it("gives visitors the show's theme", () => {
    expect(showThemeHead(matches({ context: { session: null }, search: {} }), theme)).toEqual(themed)
    expect(showThemeHead([], theme)).toEqual(themed)
  })

  it("keeps the site's theme for signed-in users, whose page is in the shell", () => {
    expect(showThemeHead(matches({ context: { session: { user: { id: 'u' } } }, search: {} }), theme)).toEqual(none)
  })

  it("gives signed-in users the show's theme in the visitor's view and on its own domain", () => {
    const signedIn = { session: { user: { id: 'u' } } }
    expect(showThemeHead(matches({ context: signedIn, search: { preview: true } }), theme)).toEqual(themed)
    vi.mocked(isCustomDomain).mockReturnValue(true)
    expect(showThemeHead(matches({ context: signedIn, search: {} }), theme)).toEqual(themed)
  })

  it('is nothing for a show without a theme', () => {
    expect(showThemeHead(matches({ context: { session: null } }), null)).toEqual(none)
  })
})
