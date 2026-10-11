import { Link, useRouteContext } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { ListenerEpisodeList } from '~/components/listener-episode-list'
import { NewPodcastDialog } from '~/components/new-podcast-dialog'
import { PageSection } from '~/components/page-section'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import type { fetchListenerHome } from '~/functions/library'

export type ListenerHomeData = Awaited<ReturnType<typeof fetchListenerHome>>

// The signed-in home page for someone who listens rather than makes podcasts:
// what they were part-way through, what's new from the podcasts they follow,
// what's popular, and what they liked lately.
export function ListenerHome({ data }: { data: ListenerHomeData }) {
  const { session } = useRouteContext({ from: '__root__' })
  const firstName = session?.user?.name?.split(' ')[0]
  const { continueListening, newEpisodes, liked, popular } = data

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-4 md:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        </h1>
        <p className="text-muted-foreground">Pick up where you left off, or find something new.</p>
      </header>

      <ContinueListening episodes={continueListening} />

      <PageSection
        title="New from podcasts you follow"
        more={newEpisodes.length > 0 ? { label: 'See all', to: '/following' } : undefined}
      >
        {newEpisodes.length > 0 ? (
          <ListenerEpisodeList episodes={newEpisodes} />
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icons.follow className="size-5" />
              </span>
              <div className="flex-1">
                <p className="font-medium">Follow podcasts to fill this up</p>
                <p className="text-sm text-muted-foreground">Their new episodes will show up here as they come out.</p>
              </div>
              <Button asChild>
                <Link to="/explore">
                  <Icons.explore />
                  Explore podcasts
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </PageSection>

      {popular.length > 0 && (
        <PageSection title="Popular this month" more={{ label: 'Explore', to: '/explore' }}>
          <ListenerEpisodeList episodes={popular} />
        </PageSection>
      )}

      {liked.length > 0 && (
        <PageSection title="Recently liked" more={{ label: 'All likes', to: '/likes' }}>
          <ListenerEpisodeList episodes={liked} />
        </PageSection>
      )}

      <Card className="bg-muted/40">
        <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background text-foreground">
            <Icons.logo className="size-5" />
          </span>
          <div className="flex-1">
            <p className="font-medium">Fancy making your own?</p>
            <p className="text-sm text-muted-foreground">
              Turn YouTube, Mixcloud or SoundCloud links, or your own audio, into a podcast with its own feed.
            </p>
          </div>
          <NewPodcastDialog>
            <Button variant="outline">
              <Icons.add />
              Create a podcast
            </Button>
          </NewPodcastDialog>
        </CardContent>
      </Card>
    </div>
  )
}

// Episodes the listener started and hasn't finished. Nothing at all when
// there are none, so it doesn't nag.
export function ContinueListening({ episodes }: { episodes: ListenerHomeData['continueListening'] }) {
  if (episodes.length === 0) return null
  return (
    <PageSection title="Continue listening">
      <ListenerEpisodeList episodes={episodes} />
    </PageSection>
  )
}
