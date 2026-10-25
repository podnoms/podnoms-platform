// Reads a theme's CSS, such as tweakcn's Code panel gives (or app.css's own
// :root and .dark blocks), for the Theme tab's Import.
import { colourKeys, otherKeys, type ModeStyles, type ThemeModes } from '~/lib/theme-schema'

const known = new Set<string>([...colourKeys, ...otherKeys])
// Other names the same settings go by: app.css's letter spacing.
const aliases: Record<string, string> = { 'tracking-normal': 'letter-spacing' }

// The variables in the `:root` and `.dark` rules, over `base` (the theme being
// edited); null if there are none the site uses.
export function parseThemeCss(css: string, base: ThemeModes): ThemeModes | null {
  const found: { light: Partial<ModeStyles>; dark: Partial<ModeStyles> } = { light: {}, dark: {} }
  let count = 0
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Innermost rules only, so ones inside @layer or @media are found too.
  for (const [, selector, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const mode = /\.dark\b/.test(selector!) ? 'dark' : /:root\b/.test(selector!) ? 'light' : null
    if (!mode) continue
    for (const [, name, value] of body!.matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)) {
      const key = aliases[name!] ?? name!
      const clean = value!.trim()
      if (!known.has(key) || !clean || /[<>{}]/.test(clean)) continue
      found[mode][key as keyof ModeStyles] = clean
      count++
    }
  }
  if (count === 0) return null
  return { light: { ...base.light, ...found.light }, dark: { ...base.dark, ...found.dark } }
}
