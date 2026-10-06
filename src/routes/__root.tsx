/// <reference types="vite/client" />
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRoute, useMatches } from '@tanstack/react-router'
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
import { fetchErrorReportingDsn } from '~/functions/error-reporting'
import { fetchMyPodcasts } from '~/functions/podcasts'
import { fetchSiteLinks } from '~/functions/site-links'
import { readPodcastSort } from '~/lib/podcast-sort'
import { startClientErrorReporting } from '~/lib/client-errors'
import { loginSearchSchema } from '~/lib/login-search'
import appCss from '~/styles/app.css?url'

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    // Renders the page on its own, without the app's shell, header, player or
    // dialogs, as for the embeddable player.
    bare?: boolean
    // A public page (a podcast or episode anyone can visit), shown as visitors
    // see it even to signed-in users: with the player, but without the app's
    // sidebar, top nav or public header.
    publicPage?: boolean
  }
}

// Full-document SSR: the root route renders <html> itself, so the server
// streams the entire document and the client hydrates it.
export const Route = createRootRoute({
  // Makes the signed-in user available to every route as `context.session`,
  // and, while a sign-in waits for its second factor, `context.twoFactor`.
  beforeLoad: () => fetchAuthState(),
  validateSearch: loginSearchSchema,
  // OAuth providers with keys (for the login dialog), the user's podcasts
  // (for the sidebar), where to report browser errors, and where to donate
  // and chat (for the top nav). Loaded once; creating a podcast calls router.invalidate().
  loader: async ({ context }) => {
    const [providers, podcasts, errorReportingDsn, siteLinks] = await Promise.all([
      fetchOAuthProviders(),
      context.session ? fetchMyPodcasts() : [],
      fetchErrorReportingDsn(),
      fetchSiteLinks(),
    ])
    return { providers, podcasts, podcastSort: readPodcastSort(), errorReportingDsn, siteLinks }
  },
  staleTime: Infinity,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'podnoms' },
      // Pages with their own description (the public pages) replace this one.
      {
        name: 'description',
        content: 'Turn YouTube, Mixcloud and SoundCloud links, or your own audio and video, into podcasts with their own RSS feeds.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { session } = Route.useRouteContext()
  const { errorReportingDsn } = Route.useLoaderData()
  useEffect(() => startClientErrorReporting(errorReportingDsn), [errorReportingDsn])
  const bare = useMatches({ select: (matches) => matches.some((match) => match.staticData.bare) })
  const publicPage = useMatches({ select: (matches) => matches.some((match) => match.staticData.publicPage) })
  return (
    <RootDocument signedIn={Boolean(session)} bare={bare} publicPage={publicPage}>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({
  signedIn,
  bare,
  publicPage,
  children,
}: {
  signedIn: boolean
  bare: boolean
  publicPage: boolean
  children: ReactNode
}) {
  return (
    // ThemeProvider's inline script sets the theme class on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script defer src="https://a.ferg.al/script.js" data-website-id="96e2c096-bf04-41b8-993e-5f7912b29878" />
      </head>
      {/* Browser extensions add attributes to <body> before React hydrates. */}
      <body suppressHydrationWarning>
        <ThemeProvider>
          {/* The app shell (sidebar and top nav) is only for signed-in users,
              and not on public pages. Everyone gets the player, so public
              pages can play episodes. */}
          {bare ? (
            children
          ) : (
            // One player around both layouts, so what's playing carries on
            // between the app and public pages.
            <PlayerProvider signedIn={signedIn}>
              {signedIn && !publicPage ? (
                <SidebarProvider style={{ '--sidebar-width': '18rem' } as CSSProperties}>
                  <AppSidebar />
                  {/* --top-nav-height lets sticky content sit below the sticky top nav. */}
                  <SidebarInset className="pb-(--player-height)" style={{ '--top-nav-height': '3.5rem' } as CSSProperties}>
                    <TopNav />
                    {children}
                  </SidebarInset>
                </SidebarProvider>
              ) : (
                <>
                  {!publicPage && <PublicHeader />}
                  <div className="pb-(--player-height)">{children}</div>
                </>
              )}
              {/* Outside the sidebar layout, so it spans the full width below the sidebar. */}
              <PlayerBar />
            </PlayerProvider>
          )}
          {!bare && (
            <>
              <LoginDialog />
              <TwoFactorDialog />
            </>
          )}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
