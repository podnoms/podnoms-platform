/// <reference types="vite/client" />
import type { ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { AppSidebar } from '~/components/app-sidebar'
import { ThemeProvider } from '~/components/theme-provider'
import { TopNav } from '~/components/top-nav'
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import { LoginDialog } from '~/components/login-dialog'
import { PlayerBar } from '~/components/player/player-bar'
import { PlayerProvider } from '~/components/player/player-provider'
import { PublicHeader } from '~/components/public-header'
import { TwoFactorDialog } from '~/components/two-factor-dialog'
import { fetchOAuthProviders, fetchAuthState } from '~/functions/auth'
import { fetchMyPodcasts } from '~/functions/podcasts'
import { loginSearchSchema } from '~/lib/login-search'
import appCss from '~/styles/app.css?url'

// Full-document SSR: the root route renders <html> itself, so the server
// streams the entire document and the client hydrates it.
export const Route = createRootRoute({
  // Makes the signed-in user available to every route as `context.session`,
  // and, while a sign-in waits for its second factor, `context.twoFactor`.
  beforeLoad: () => fetchAuthState(),
  validateSearch: loginSearchSchema,
  // OAuth providers with keys (for the login dialog) and the user's podcasts
  // (for the sidebar). Loaded once; creating a podcast calls router.invalidate().
  loader: async ({ context }) => {
    const [providers, podcasts] = await Promise.all([
      fetchOAuthProviders(),
      context.session ? fetchMyPodcasts() : [],
    ])
    return { providers, podcasts }
  },
  staleTime: Infinity,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'podnoms' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { session } = Route.useRouteContext()
  return (
    <RootDocument signedIn={Boolean(session)}>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  return (
    // ThemeProvider's inline script sets the theme class on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      {/* Browser extensions add attributes to <body> before React hydrates. */}
      <body suppressHydrationWarning>
        <ThemeProvider>
          {/* The app shell (sidebar and top nav) is only for signed-in users. */}
          {signedIn ? (
            <PlayerProvider>
              <SidebarProvider>
                <AppSidebar />
                <SidebarInset className="pb-(--player-height)">
                  <TopNav />
                  {children}
                </SidebarInset>
              </SidebarProvider>
              {/* Outside the sidebar layout, so it spans the full width below the sidebar. */}
              <PlayerBar />
            </PlayerProvider>
          ) : (
            <>
              <PublicHeader />
              {children}
            </>
          )}
          <LoginDialog />
          <TwoFactorDialog />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
