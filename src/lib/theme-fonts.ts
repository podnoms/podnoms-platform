// The Google Fonts a theme can use (see theme-schema.ts): the ones admins
// choose from on the Theme tab, tweakcn's list, plus the others its presets
// name. The site serves its own copies (see fonts.server.ts), so visitors'
// browsers never ask Google for them.
import type { ModeStyles } from '~/lib/theme-schema'

export type FontCategory = 'sans' | 'serif' | 'mono'
export const fontKeys = { sans: 'font-sans', serif: 'font-serif', mono: 'font-mono' } as const

// Each font's category and the weights asked for (all Google has, up to four).
const catalogue: Record<string, { category: FontCategory; weights: number[]; offered: boolean }> = {}
const add = (category: FontCategory, offered: boolean, fonts: Record<string, number[]>) => {
  for (const [name, weights] of Object.entries(fonts)) catalogue[name] = { category, weights, offered }
}
const regular = [400, 500, 600, 700]

// tweakcn's list (with Space Grotesk, which it files under serif, as the sans
// it is), which admins choose from.
add('sans', true, {
  Inter: regular,
  Roboto: regular,
  'Open Sans': regular,
  Poppins: regular,
  Montserrat: regular,
  Outfit: regular,
  'Plus Jakarta Sans': regular,
  'DM Sans': regular,
  Geist: regular,
  Oxanium: regular,
  'Architects Daughter': [400],
  'Space Grotesk': regular,
})
add('serif', true, {
  Merriweather: regular,
  'Playfair Display': regular,
  Lora: regular,
  'Source Serif Pro': [400, 600, 700],
  'Libre Baskerville': [400, 700],
})
add('mono', true, {
  'JetBrains Mono': regular,
  'Fira Code': regular,
  'Source Code Pro': regular,
  'IBM Plex Mono': regular,
  'Roboto Mono': regular,
  'Space Mono': [400, 700],
  'Geist Mono': regular,
})
// Named by presets (or tweakcn's own font map) but not offered.
add('sans', false, { 'IBM Plex Sans': regular, Antic: [400], Quicksand: regular })
add('serif', false, { 'Source Serif 4': regular })
add('mono', false, { 'Ubuntu Mono': [400, 700] })

// The fonts admins choose from, by category.
export const fontChoices = Object.fromEntries(
  (['sans', 'serif', 'mono'] as const).map((category) => [
    category,
    Object.keys(catalogue).filter((name) => catalogue[name]!.offered && catalogue[name]!.category === category),
  ]),
) as Record<FontCategory, string[]>

const fallbacks: Record<FontCategory, string> = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' }

// A font as a theme names it, with the generic family after it, as tweakcn does.
export function fontStack(name: string, category: FontCategory) {
  return `${name}, ${fallbacks[category]}`
}

// The first family in a font stack, unquoted: "DM Sans" from `"DM Sans", sans-serif`.
export function firstFamily(stack: string | undefined) {
  return stack?.split(',')[0]?.trim().replace(/^["']|["']$/g, '') || null
}

export function isGoogleFont(name: string | null): name is string {
  return name !== null && Object.hasOwn(catalogue, name)
}

// The Google Fonts a theme's fonts start with, which the site must serve.
export function googleFontsIn(styles: Partial<ModeStyles>) {
  const names = Object.values(fontKeys).map((key) => firstFamily(styles[key]))
  return [...new Set(names.filter(isGoogleFont))]
}

// "Plus Jakarta Sans" as "plus-jakarta-sans", the font's folder and URL.
export function fontSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function fontBySlug(slug: string) {
  return Object.keys(catalogue).find((name) => fontSlug(name) === slug) ?? null
}

// The stylesheet the site serves for the font (see fonts.$family.$file.ts).
export function fontCssUrl(name: string) {
  return `/fonts/${fontSlug(name)}/font.css`
}

// Where Google has it, for the server to download.
export function googleFontCssUrl(name: string) {
  const { weights } = catalogue[name]!
  const family = name.replaceAll(' ', '+') + (weights.length > 1 || weights[0] !== 400 ? `:wght@${weights.join(';')}` : '')
  return `https://fonts.googleapis.com/css2?family=${family}&display=swap`
}
