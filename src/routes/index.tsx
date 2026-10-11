import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { Dashboard } from '~/components/dashboard'
import { LandingPage } from '~/components/landing-page'
import { ContinueListening, ListenerHome } from '~/components/listener-home'
import { fetchDashboard } from '~/functions/dashboard'
import { fetchListenerHome } from '~/functions/library'
import { siteHead } from '~/lib/page-meta'
import { siteDescription, siteInfo } from '~/lib/site'
import { jsonLdMeta, websiteJsonLd } from '~/lib/structured-data'

export const Route = createFileRoute('/')({
  // For signed-in users: the dashboard (starting with the last 30 days), for
  // those with podcasts, and what they're listening to, for everyone.
  loader: async ({ context }) => {
    if (!context.session) return null
    const [dashboard, listening] = await Promise.all([fetchDashboard({ data: { days: 30 } }), fetchListenerHome()])
    return { dashboard, listening }
  },
  head: ({ matches }) => {
    const site = siteInfo(matches)
    if (!site?.origin) return {}
    const head = siteHead({
      origin: site.origin,
      path: '/',
      title: 'podnoms · Turn YouTube, Mixcloud and SoundCloud links into podcasts',
      description: siteDescription,
    })
    const jsonLd = websiteJsonLd({ origin: site.origin, description: siteDescription, discordUrl: site.discordUrl ?? null })
    return { ...head, meta: [...head.meta, jsonLdMeta(jsonLd)] }
  },
  component: Index,
})

const rootRoute = getRouteApi('__root__')

// Signed-out visitors get the landing page; signed-in users their podcasts'
// dashboard, or, if they've none, a home page for listening.
function Index() {
  const { session } = Route.useRouteContext()
  return session ? <Home /> : <LandingPage />
}

function Home() {
  const { podcasts } = rootRoute.useLoaderData()
  const data = Route.useLoaderData()
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
