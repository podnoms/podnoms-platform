import { createFileRoute } from '@tanstack/react-router'
import { LandingPage } from '~/components/landing-page'
import { getServerInfo } from '~/functions/items'

// ssr: true (the default) — loader runs on the server and the component is
// rendered to HTML. Best for content that should be indexable and fast to paint.
export const Route = createFileRoute('/')({
  ssr: true,
  loader: () => getServerInfo(),
  component: Index,
})

// Signed-out visitors get the landing page; signed-in users their home page.
function Index() {
  const { session } = Route.useRouteContext()
  return session ? <Home /> : <LandingPage />
}

function Home() {
  const info = Route.useLoaderData()
  return (
    <main className="container mx-auto p-4">
      <h1>podnoms</h1>
      <p>
        Rendered on the server at <time>{info.renderedAt}</time> by Node {info.node}.
      </p>
    </main>
  )
}
