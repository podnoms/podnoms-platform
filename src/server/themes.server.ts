// Saving a theme, the site's (branding.server.ts) or a show's (shows.server.ts).
import '@tanstack/react-start/server-only'
import { googleFontsIn } from '~/lib/theme-fonts'
import { pickStyles, type SiteTheme } from '~/lib/theme-schema'
import { prepareFonts } from '~/server/fonts.server'

// The theme as it's saved: only the values the site uses, with its Google
// Fonts downloaded first, so they're ready for the first visitor (a font that
// can't be is tried again then). Null (no theme) stays null.
export async function prepareTheme(theme: SiteTheme | null): Promise<SiteTheme | null> {
  if (!theme) return null
  await prepareFonts(googleFontsIn({ ...theme.styles.dark, ...theme.styles.light }))
  return { basedOn: theme.basedOn, styles: { light: pickStyles(theme.styles.light), dark: pickStyles(theme.styles.dark) } }
}
