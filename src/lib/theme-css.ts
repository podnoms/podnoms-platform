// A theme (see theme-schema.ts) as CSS: the theme variables app.css sets on
// :root and .dark, overridden for both modes. Used on the server, for the
// site's theme in every page's <head> and a show's on its public pages, and in
// the editors, to preview a theme before it's saved.
import { fontCssUrl, googleFontsIn } from '~/lib/theme-fonts'
import { colourKeys, type ModeStyles, type SiteTheme, type ThemeModes } from '~/lib/theme-schema'

// What a theme that doesn't describe its shadows gets: a soft drop shadow,
// as tweakcn (where the presets come from) gives them.
const shadowDefaults = {
  'shadow-color': 'hsl(0 0% 0%)',
  'shadow-opacity': '0.1',
  'shadow-blur': '3px',
  'shadow-spread': '0px',
  'shadow-offset-x': '0',
  'shadow-offset-y': '1px',
}

// The shadow scale app.css's shadow utilities read, built from the theme's
// shadow settings the way tweakcn builds it.
function shadows(styles: Partial<ModeStyles>) {
  const s = { ...shadowDefaults, ...definedOnly(styles) }
  const opacity = Number.parseFloat(s['shadow-opacity']) || 0
  const colour = (strength: number) =>
    `color-mix(in srgb, ${s['shadow-color']} ${Math.min(100, Math.round(opacity * strength * 100))}%, transparent)`
  const x = s['shadow-offset-x']
  const first = (strength: number) => `${x} ${s['shadow-offset-y']} ${s['shadow-blur']} ${s['shadow-spread']} ${colour(strength)}`
  const second = (y: string, blur: string) => `${x} ${y} ${blur} calc(${s['shadow-spread']} - 1px) ${colour(1)}`
  return {
    'shadow-2xs': first(0.5),
    'shadow-xs': first(0.5),
    'shadow-sm': `${first(1)}, ${second('1px', '2px')}`,
    shadow: `${first(1)}, ${second('1px', '2px')}`,
    'shadow-md': `${first(1)}, ${second('2px', '4px')}`,
    'shadow-lg': `${first(1)}, ${second('4px', '6px')}`,
    'shadow-xl': `${first(1)}, ${second('8px', '10px')}`,
    'shadow-2xl': first(2.5),
  }
}

function definedOnly(styles: Partial<ModeStyles>) {
  return Object.fromEntries(Object.entries(styles).filter(([, value]) => value)) as Partial<Record<string, string>>
}

// One mode's variables. Settings a theme only gives for its other mode
// (radius and shadows, often, in the presets) are taken from there.
function variables(styles: ModeStyles, other: ModeStyles) {
  const merged = { ...definedOnly(other), ...definedOnly(styles) } as Partial<ModeStyles>
  const vars: Record<string, string> = {}
  for (const key of colourKeys) vars[key] = styles[key]
  for (const key of ['font-sans', 'font-serif', 'font-mono'] as const) if (merged[key]) vars[key] = merged[key]
  if (merged.radius) vars.radius = merged.radius
  // app.css spaces letters by --tracking-normal.
  if (merged['letter-spacing']) vars['tracking-normal'] = merged['letter-spacing']
  return { ...vars, ...shadows(merged) }
}

const block = (selector: string, vars: Record<string, string>) =>
  `${selector}{${Object.entries(vars)
    .map(([key, value]) => `--${key}:${value.replace(/[<>{};]/g, '')}`)
    .join(';')}}`

// The theme's CSS. Its selectors outrank app.css's :root and .dark, wherever
// it's put on the page; a show's (`over: 'site'`) outranks the site's too, as
// it's in the page's head before the site's, and the preview of a show's
// theme on its Theme tab (`over: 'show'`) outranks the show's saved one. Its
// Google Fonts are loaded separately (see googleFontsIn).
export function themeCss({ light, dark }: ThemeModes, { over }: { over?: 'site' | 'show' } = {}) {
  const repeat = over === 'show' ? 3 : over === 'site' ? 2 : 1
  return (
    block(`html${':root'.repeat(repeat)}`, variables(light, dark)) + block(`html${'.dark'.repeat(repeat)}`, variables(dark, light))
  )
}

// What a page needs to show a saved theme: its CSS and the Google Fonts it
// uses (each a name for fontCssUrl).
export function themeAssets({ styles }: SiteTheme, options?: { over?: 'site' }) {
  return { css: themeCss(styles, options), fonts: googleFontsIn({ ...styles.dark, ...styles.light }) }
}

// A show's theme (from themeAssets) as a public page's head adds it: its
// fonts' stylesheets and its CSS. Nothing without one.
export function themeHead(theme: { css: string; fonts: string[] } | null) {
  if (!theme) return { links: [], styles: [] }
  return {
    links: theme.fonts.map((font) => ({ rel: 'stylesheet', href: fontCssUrl(font) })),
    styles: [{ children: theme.css }],
  }
}
