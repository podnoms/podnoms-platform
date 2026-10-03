import { Link, createFileRoute, getRouteApi } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { LandingPage } from '~/components/landing-page'
import { NewPodcastDialog } from '~/components/new-podcast-dialog'
import { Button } from '~/components/ui/button'
import { Card, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'

export const Route = createFileRoute('/')({
  component: Index,
})

const rootRoute = getRouteApi('__root__')

// Signed-out visitors get the landing page; signed-in users their podcasts.
function Index() {
  const { session } = Route.useRouteContext()
  return session ? <Home /> : <LandingPage />
}

function Home() {
  const { podcasts } = rootRoute.useLoaderData()

  if (podcasts.length === 0) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.logo />
            </EmptyMedia>
            <EmptyTitle>No podcasts yet</EmptyTitle>
            <EmptyDescription>Create your first podcast to start adding episodes.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewPodcastDialog>
              <Button>
                <Icons.add />
                New podcast
              </Button>
            </NewPodcastDialog>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold">Your podcasts</h1>
        <NewPodcastDialog>
          <Button className="ml-auto">
            <Icons.add />
            New podcast
          </Button>
        </NewPodcastDialog>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {podcasts.map((podcast) => (
          <Link key={podcast.id} to="/podcasts/$slug/manage" params={{ slug: podcast.slug }}>
            <Card>
              <CardHeader>
                <CardTitle>{podcast.title}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  )
}
