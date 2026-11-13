// Whether a page is drawn inside the app's shell (the sidebar and top nav),
// which is for signed-in users. Public pages get it too, so someone signed in
// never leaves the app by opening a show or an episode, except on a show's
// own domain, which has no accounts, and in the visitor's view (`?preview=true`,
// see login-search.ts), which the owner's Theme tab shows.
import { isCustomDomain } from '~/lib/current-domain'
import { themeHead } from '~/lib/theme-css'

export function inAppShell({ signedIn, publicPage, preview }: { signedIn: boolean; publicPage: boolean; preview: boolean }) {
  return signedIn && !preview && !(publicPage && isCustomDomain())
}

type Match = { routeId: string; context?: unknown; search?: unknown }

// A show's theme for the head() of one of its public pages (the show, its
// episodes, its live page): visitors get it, but inside the app's shell the
// page keeps the site's theme, as the shell around it does.
export function showThemeHead(matches: ReadonlyArray<Match>, theme: Parameters<typeof themeHead>[0]) {
  const root = matches.find((match) => match.routeId === '__root__')
  const signedIn = Boolean((root?.context as { session?: unknown } | undefined)?.session)
  const preview = (root?.search as { preview?: boolean } | undefined)?.preview === true
  return themeHead(inAppShell({ signedIn, publicPage: true, preview }) ? null : theme)
}
