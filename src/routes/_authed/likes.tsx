import { createFileRoute, Link } from '@tanstack/react-router'
import { EpisodeListEnd } from '~/components/episode-list-end'
import { Icons } from '~/components/icons'
import { ListenerEpisodeList } from '~/components/listener-episode-list'
import { PageHeading } from '~/components/page-section'
import { Button } from '~/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { fetchLikes, fetchMoreLikes } from '~/functions/library'
import { useEpisodePages } from '~/hooks/use-episode-pages'
import { pluralise } from '~/lib/format'
import { pageTitle } from '~/lib/branding'

// The episodes the user likes, most recently liked first. Unliking one here
// leaves it in the list until the page reloads, so it can be liked again.
export const Route = createFileRoute('/_authed/likes')({
  loader: () => fetchLikes(),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Likes') }] }),
  component: LikesPage,
})

function LikesPage() {
  const { episodes: first, total } = Route.useLoaderData()
  const { episodes, ...more } = useEpisodePages({
    podcastSlug: 'likes',
    first,
    total,
    fetchMore: (offset, limit) => fetchMoreLikes({ data: { offset, limit } }),
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <PageHeading
        icon={<Icons.like />}
        title="Likes"
        description={total > 0 ? pluralise(total, 'episode') : 'Episodes you like, all in one place.'}
      />
      {total === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.like />
            </EmptyMedia>
            <EmptyTitle>No likes yet</EmptyTitle>
            <EmptyDescription>Tap the heart on any episode and it'll be kept here for you.</EmptyDescription>
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
        <div className="flex flex-col gap-3">
          <ListenerEpisodeList episodes={episodes} />
          <EpisodeListEnd {...more} />
        </div>
      )}
    </div>
  )
}
