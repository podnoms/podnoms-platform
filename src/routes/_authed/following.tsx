import { createFileRoute, Link } from '@tanstack/react-router'
import { EpisodeListEnd } from '~/components/episode-list-end'
import { Icons } from '~/components/icons'
import { ListenerEpisodeList } from '~/components/listener-episode-list'
import { PageHeading, PageSection } from '~/components/page-section'
import { PodcastGrid } from '~/components/podcast-card'
import { Button } from '~/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { fetchFollowing, fetchMoreFollowingEpisodes } from '~/functions/library'
import { useEpisodePages } from '~/hooks/use-episode-pages'
import { pluralise } from '~/lib/format'

// The podcasts the user follows, and their episodes, newest first.
export const Route = createFileRoute('/_authed/following')({
  loader: () => fetchFollowing(),
  head: () => ({ meta: [{ title: 'Following · podnoms' }] }),
  component: FollowingPage,
})

function FollowingPage() {
  const { podcasts, episodes: first } = Route.useLoaderData()
  const { episodes, ...more } = useEpisodePages({
    podcastSlug: 'following',
    first,
    // No count is kept; a short page means the end.
    total: Number.POSITIVE_INFINITY,
    fetchMore: (offset, limit) => fetchMoreFollowingEpisodes({ data: { offset, limit } }),
  })

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 p-4 md:p-8">
      <PageHeading
        icon={<Icons.following />}
        title="Following"
        description={podcasts.length > 0 ? pluralise(podcasts.length, 'podcast') : 'Podcasts you follow, and what they put out.'}
      />
      {podcasts.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.follow />
            </EmptyMedia>
            <EmptyTitle>You're not following any podcasts</EmptyTitle>
            <EmptyDescription>Follow a podcast to get its new episodes on your home page.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/explore">
                <Icons.explore />
                Explore podcasts
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <PageSection title="Podcasts">
            <PodcastGrid podcasts={podcasts} />
          </PageSection>
          <PageSection title="Latest episodes">
            {episodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">They haven't put out any episodes yet.</p>
            ) : (
              <>
                <ListenerEpisodeList episodes={episodes} />
                <EpisodeListEnd {...more} />
              </>
            )}
          </PageSection>
        </>
      )}
    </div>
  )
}
