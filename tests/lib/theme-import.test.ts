import { describe, expect, it } from 'vitest'
import { parseThemeCss } from '~/lib/theme-import'
import { themePresets } from '~/lib/theme-presets'
import { pickStyles } from '~/lib/theme-schema'

const base = {
  light: pickStyles(themePresets['modern-minimal']!.styles.light),
  dark: pickStyles(themePresets['modern-minimal']!.styles.dark),
}

describe('parseThemeCss', () => {
  it("reads tweakcn's :root and .dark variables over the theme being edited", () => {
    const css = `
      :root {
        --background: oklch(1 0 0);
        --primary: oklch(0.6 0.2 25); /* the brand colour */
        --radius: 0.75rem;
        --font-sans: Inter, sans-serif;
        --shadow-opacity: 0.2;
      }
      .dark {
        --primary: oklch(0.7 0.18 25);
      }
    `
    const theme = parseThemeCss(css, base)!
    expect(theme.light).toMatchObject({
      background: 'oklch(1 0 0)',
      primary: 'oklch(0.6 0.2 25)',
      radius: '0.75rem',
      'shadow-opacity': '0.2',
    })
    expect(theme.light['font-sans']).toBe('Inter, sans-serif')
    expect(theme.light.foreground).toBe(base.light.foreground)
    expect(theme.dark.primary).toBe('oklch(0.7 0.18 25)')
    expect(theme.dark.background).toBe(base.dark.background)
  })

  it('finds the rules inside @layer, and reads letter spacing by either name', () => {
    const theme = parseThemeCss('@layer base { :root { --tracking-normal: 0.02em; } }', base)!
    expect(theme.light['letter-spacing']).toBe('0.02em')
  })

  it('is null when there is nothing the site uses', () => {
    expect(parseThemeCss('body { color: red }', base)).toBeNull()
    expect(parseThemeCss(':root { --spacing: 0.3rem; }', base)).toBeNull()
  })

  it('ignores values that could break out of the rule', () => {
    expect(parseThemeCss(':root { --primary: red</style><script> }', base)).toBeNull()
  })
})
