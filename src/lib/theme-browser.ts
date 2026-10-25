// Browser-only helpers for the Theme tab's editor.
import { fontCssUrl, isGoogleFont } from '~/lib/theme-fonts'
import { colourKeys, otherKeys, type ModeStyles, type ThemeModes } from '~/lib/theme-schema'

let canvas: CanvasRenderingContext2D | null | undefined

// Any CSS colour (hex, rgb, hsl, oklch…) as #rrggbb, for the colour input,
// which only takes hex; null if it isn't a colour. Drawn and read back, so the
// browser does the converting.
export function colourToHex(colour: string) {
  // On the server, which renders the page before the browser takes over.
  if (typeof document === 'undefined' || !CSS.supports('color', colour)) return null
  canvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!canvas) return null
  canvas.clearRect(0, 0, 1, 1)
  canvas.fillStyle = colour
  canvas.fillRect(0, 0, 1, 1)
  const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((part) => part!.toString(16).padStart(2, '0')).join('')}`
}

const variableNames = new Map<string, keyof ModeStyles>([
  ...[...colourKeys, ...otherKeys].map((key) => [`--${key}`, key] as const),
  ['--tracking-normal', 'letter-spacing'],
])

// app.css's own theme, from its :root and .dark rules in the page's
// stylesheets, so the Default theme can be edited too.
export function readAppTheme(): ThemeModes {
  const found: { light: Partial<ModeStyles>; dark: Partial<ModeStyles> } = { light: {}, dark: {} }
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && (rule.selectorText === ':root' || rule.selectorText === '.dark')) {
        const mode = rule.selectorText === ':root' ? found.light : found.dark
        for (const name of Array.from(rule.style)) {
          const key = variableNames.get(name)
          const value = rule.style.getPropertyValue(name).trim()
          if (key && value) mode[key] = value
        }
      }
      if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules)
    } catch {
      // Another site's stylesheet, whose rules can't be read.
    }
  }
  return { light: found.light as ModeStyles, dark: { ...found.light, ...found.dark } as ModeStyles }
}

// Loads the theme fonts (see theme-fonts.ts) from the site's copies, for
// previews; others (system fonts) are left to the browser.
export function loadFonts(names: (string | null)[]) {
  for (const name of names) {
    if (!isGoogleFont(name)) continue
    const href = fontCssUrl(name)
    if (document.head.querySelector(`link[href="${href}"]`)) continue
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.append(link)
  }
}
