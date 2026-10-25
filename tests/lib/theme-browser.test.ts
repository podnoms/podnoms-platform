// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { readAppTheme } from '~/lib/theme-browser'

afterEach(() => document.head.replaceChildren())

function addStyle(css: string) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
}

describe('readAppTheme', () => {
  it("reads app.css's light and dark variables, ignoring the saved theme's", () => {
    addStyle(`
      :root { --primary: oklch(0.65 0.24 27); --radius: 0px; --tracking-normal: 0em; --font-sans: DM Sans; }
      .dark { --primary: oklch(0.7 0.19 23); }
      .dark .menu { --primary: red; }
    `)
    addStyle('html:root{--primary:#3b82f6}html.dark{--primary:#3b82f6}')
    const theme = readAppTheme()
    expect(theme.light).toMatchObject({ primary: 'oklch(0.65 0.24 27)', radius: '0px', 'letter-spacing': '0em' })
    expect(theme.light['font-sans']).toBe('DM Sans')
    expect(theme.dark.primary).toBe('oklch(0.7 0.19 23)')
    // The dark mode has what it doesn't set itself from the light.
    expect(theme.dark.radius).toBe('0px')
  })
})
