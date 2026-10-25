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
import { fetchBranding } from '~/functions/branding'
import { fetchErrorReportingDsn } from '~/functions/error-reporting'
import { fetchFollowedPodcasts } from '~/functions/library'
import { fetchMyPodcasts } from '~/functions/podcasts'
import { fetchSiteLinks } from '~/functions/site-links'
import { readPodcastSort } from '~/lib/podcast-sort'
import { brandIconUrl, defaultBranding } from '~/lib/branding'
import { startClientErrorReporting } from '~/lib/client-errors'
import { currentDomainSlug } from '~/lib/current-domain'
import { loginSearchSchema } from '~/lib/login-search'
import appCss from '~/styles/app.css?url'

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    // Renders the page on its own, without the app's shell, header, player or
    // dialogs, as for the embeddable player.
    bare?: boolean
    // A public page (a podcast or episode anyone can visit). Visitors get it
    // with the player but without the public header, as the podcast's own
    // page; signed-in users get it in the app's shell, so their library is a
    // click away, except on the podcast's own domain.
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
  // OAuth providers with keys (for the login dialog), the user's podcasts and
  // the ones they follow (for the sidebar), where to report browser errors,
  // where to donate and chat (for the top nav), and the site's branding.
  // Loaded once; creating or following a podcast, or saving the branding,
  // calls router.invalidate().
  loader: async ({ context }) => {
    const [providers, podcasts, following, errorReportingDsn, siteLinks, branding] = await Promise.all([
      fetchOAuthProviders(),
      context.session ? fetchMyPodcasts() : [],
      context.session ? fetchFollowedPodcasts() : [],
      fetchErrorReportingDsn(),
      fetchSiteLinks(),
      fetchBranding(),
    ])
    return { providers, podcasts, following, podcastSort: readPodcastSort(), errorReportingDsn, siteLinks, branding }
  },
  staleTime: Infinity,
  // Defaults: a page's own tags of the same name or property replace these.
  head: ({ loaderData }) => {
    const branding = loaderData?.branding ?? defaultBranding
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: branding.name },
        { name: 'description', content: branding.description },
        { property: 'og:site_name', content: branding.name },
        { name: 'twitter:card', content: 'summary' },
        { name: 'theme-color', content: '#ffffff' },
        loaderData?.siteLinks.googleSiteVerification
          ? { name: 'google-site-verification', content: loaderData.siteLinks.googleSiteVerification }
          : undefined,
        loaderData?.siteLinks.bingSiteVerification
          ? { name: 'msvalidate.01', content: loaderData.siteLinks.bingSiteVerification }
          : undefined,
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: brandIconUrl(branding, 32) },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: brandIconUrl(branding, 16) },
        { rel: 'apple-touch-icon', sizes: '180x180', href: brandIconUrl(branding, 180) },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
      // The site's analytics, when an admin has set it up.
      scripts: branding.analytics ? [{ src: branding.analytics.src, defer: true, ...branding.analytics.attributes }] : [],
    }
  },
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
    <html lang="en" suppressHydrationWarning data-custom-domain={currentDomainSlug() ?? undefined}>
      <head>
        <HeadContent />
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
              {signedIn && !(publicPage && currentDomainSlug()) ? (
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
