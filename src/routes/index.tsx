import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { Dashboard } from '~/components/dashboard'
import { Icons } from '~/components/icons'
import { LandingPage } from '~/components/landing-page'
import { NewPodcastDialog } from '~/components/new-podcast-dialog'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { fetchDashboard } from '~/functions/dashboard'

export const Route = createFileRoute('/')({
  // The dashboard, for signed-in users, starting with the last 30 days.
  loader: ({ context }) => (context.session ? fetchDashboard({ data: { days: 30 } }) : null),
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
  const dashboard = Route.useLoaderData()

  if (podcasts.length === 0 || !dashboard) {
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

  return <Dashboard initial={dashboard} />
}
