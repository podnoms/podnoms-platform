import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { Dashboard } from '~/components/dashboard'
import { LandingPage } from '~/components/landing-page'
import { ContinueListening, ListenerHome } from '~/components/listener-home'
import { fetchDashboard } from '~/functions/dashboard'
import { fetchLandingPodcasts, fetchListenerHome } from '~/functions/library'
import { siteHead } from '~/lib/page-meta'
import { brandLogoUrl, brandingFrom } from '~/lib/branding'
import { siteInfo } from '~/lib/site'
import { jsonLdMeta, websiteJsonLd } from '~/lib/structured-data'

export const Route = createFileRoute('/')({
  // For signed-in users: the dashboard (starting with the last 30 days), for
  // those with podcasts, and what they're listening to, for everyone. Signed
  // out, some of the site's shows, for the landing page.
  loader: async ({ context }) => {
    if (!context.session) return { landing: await fetchLandingPodcasts() }
    const [dashboard, listening] = await Promise.all([fetchDashboard({ data: { days: 30 } }), fetchListenerHome()])
    return { home: { dashboard, listening } }
  },
  head: ({ matches }) => {
    const site = siteInfo(matches)
    const branding = brandingFrom(matches)
    if (!site?.origin) return {}
    const head = siteHead({
      site: branding,
      origin: site.origin,
      path: '/',
      title: `${branding.name} · ${branding.tagline}`,
      description: branding.description,
    })
    const jsonLd = websiteJsonLd({
      name: branding.name,
      origin: site.origin,
      description: branding.description,
      logo: brandLogoUrl(branding),
      discordUrl: site.discordUrl ?? null,
    })
    return { ...head, meta: [...head.meta, jsonLdMeta(jsonLd)] }
  },
  component: Index,
})

const rootRoute = getRouteApi('__root__')

// Signed-out visitors get the landing page; signed-in users their podcasts'
// dashboard, or, if they've none, a home page for listening.
function Index() {
  const { session } = Route.useRouteContext()
  const data = Route.useLoaderData()
  return session ? <Home /> : <LandingPage podcasts={data.landing ?? []} />
}

function Home() {
  const { podcasts } = rootRoute.useLoaderData()
  const data = Route.useLoaderData().home
  if (!data) return null
  if (podcasts.length === 0) return <ListenerHome data={data.listening} />
  return (
    <>
      {data.listening.continueListening.length > 0 && (
        <div className="px-4 pt-4 md:px-6 md:pt-6">
          <ContinueListening episodes={data.listening.continueListening} />
        </div>
      )}
      <Dashboard initial={data.dashboard} />
    </>
  )
}
