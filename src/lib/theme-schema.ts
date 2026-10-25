// What the site's theme is made of (see theme-presets.ts for the presets an
// admin starts from): the variables admins edit on the Theme tab, and the
// shape it's saved in.
import { z } from 'zod'
import type { ThemeStyles } from '~/lib/theme-presets'

// The colour variables, grouped as the editor shows them (and tweakcn does).
export const colourGroups = [
  { title: 'Primary', keys: ['primary', 'primary-foreground'] },
  { title: 'Secondary', keys: ['secondary', 'secondary-foreground'] },
  { title: 'Accent', keys: ['accent', 'accent-foreground'] },
  { title: 'Base', keys: ['background', 'foreground'] },
  { title: 'Card', keys: ['card', 'card-foreground'] },
  { title: 'Popover', keys: ['popover', 'popover-foreground'] },
  { title: 'Muted', keys: ['muted', 'muted-foreground'] },
  { title: 'Destructive', keys: ['destructive', 'destructive-foreground'] },
  { title: 'Border and input', keys: ['border', 'input', 'ring'] },
  { title: 'Chart', keys: ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] },
  {
    title: 'Sidebar',
    keys: [
      'sidebar',
      'sidebar-foreground',
      'sidebar-primary',
      'sidebar-primary-foreground',
      'sidebar-accent',
      'sidebar-accent-foreground',
      'sidebar-border',
      'sidebar-ring',
    ],
  },
] as const satisfies readonly { title: string; keys: readonly (keyof ThemeStyles)[] }[]

export type ColourKey = (typeof colourGroups)[number]['keys'][number]
export const colourKeys: ColourKey[] = colourGroups.flatMap((group) => group.keys)

// The rest of what the site uses. Spacing isn't, as it would change every
// layout. Fonts are Google Fonts the site serves itself (see theme-fonts.ts),
// or ones visitors already have.
export const otherKeys = [
  'font-sans',
  'font-serif',
  'font-mono',
  'radius',
  'letter-spacing',
  'shadow-color',
  'shadow-opacity',
  'shadow-blur',
  'shadow-spread',
  'shadow-offset-x',
  'shadow-offset-y',
] as const satisfies readonly (keyof ThemeStyles)[]

// Set once for both modes, as tweakcn does; the shadow's colour is per mode.
export const sharedKeys = otherKeys.filter((key) => key !== 'shadow-color')

export type ModeStyles = Record<ColourKey, string> & Partial<Record<(typeof otherKeys)[number], string>>
export type ThemeModes = { light: ModeStyles; dark: ModeStyles }

// A CSS value: anything but what could end the declaration it goes in.
const value = z.string().trim().min(1).max(200).regex(/^[^<>{};\n]+$/, 'That isn’t a CSS value')

const modeSchema = z.object({
  ...Object.fromEntries(colourKeys.map((key) => [key, value])),
  ...Object.fromEntries(otherKeys.map((key) => [key, value.optional()])),
}) as unknown as z.ZodType<ModeStyles>

// The site's theme as saved: the preset it started from (null for app.css's
// own theme), and every value, edited or not.
export const siteThemeSchema = z.object({
  basedOn: z.string().max(100).nullable(),
  styles: z.object({ light: modeSchema, dark: modeSchema }),
})
export type SiteTheme = z.infer<typeof siteThemeSchema>

// Just the values the site uses, from a preset or anything shaped like one.
export function pickStyles(styles: { [K in keyof ModeStyles]?: string }): ModeStyles {
  const picked: { [K in keyof ModeStyles]?: string } = {}
  for (const key of [...colourKeys, ...otherKeys]) if (styles[key]) picked[key] = styles[key]
  return picked as ModeStyles
}
