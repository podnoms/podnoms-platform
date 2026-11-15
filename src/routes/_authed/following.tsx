import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { EpisodeListEnd } from '~/components/episode-list-end'
import { Icons } from '~/components/icons'
import { ListenerEpisodeList } from '~/components/listener-episode-list'
import { PageHeading, PageSection } from '~/components/page-section'
import { ShowGrid } from '~/components/show-card'
import { Button } from '~/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { fetchFollowing, fetchMoreFollowingEpisodes, ignoreShow } from '~/functions/library'
import { useEpisodePages } from '~/hooks/use-episode-pages'
import { pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { showParams } from '~/lib/paths'
import { pageTitle } from '~/lib/branding'

// The shows the user follows, and their episodes, newest first.
export const Route = createFileRoute('/_authed/following')({
  loader: () => fetchFollowing(),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Following') }] }),
  component: FollowingPage,
})

function FollowingPage() {
  const { shows, episodes: first, ignored } = Route.useLoaderData()
  const { episodes, ...more } = useEpisodePages({
    showKey: 'following',
    first,
    // No count is kept; a short page means the end.
    total: Number.POSITIVE_INFINITY,
    fetchMore: (offset, limit) => fetchMoreFollowingEpisodes({ data: { offset, limit } }),
  })

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-10 p-4 md:p-8">
      <PageHeading
        icon={<Icons.following />}
        title="Following"
        description={shows.length > 0 ? pluralise(shows.length, 'show') : 'Shows you follow, and what they put out.'}
      />
      {shows.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.follow />
            </EmptyMedia>
            <EmptyTitle>You're not following any shows</EmptyTitle>
            <EmptyDescription>Follow a show to get its new episodes on your home page.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/explore">
                <Icons.explore />
                Explore shows
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <PageSection title="Shows">
            <ShowGrid shows={shows} />
          </PageSection>
          <PageSection title="Latest episodes">
            {episodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">They haven't put out any episodes yet.</p>
            ) : (
              <>
                <ListenerEpisodeList episodes={episodes} ignorable />
                <EpisodeListEnd {...more} />
              </>
            )}
          </PageSection>
        </>
      )}
      {ignored.length > 0 && <IgnoredShows shows={ignored} />}
    </div>
  )
}

type IgnoredShow = ReturnType<typeof Route.useLoaderData>['ignored'][number]

// Shows the user has ignored (from an episode's menu), which their lists
// leave out, with a way back.
function IgnoredShows({ shows }: { shows: IgnoredShow[] }) {
  return (
    <PageSection title="Ignored shows">
      <p className="-mt-2 max-w-prose text-sm text-muted-foreground">
        Their episodes are left out of your home page, Following and Explore.
      </p>
      <ul className="flex flex-col divide-y">
        {shows.map((show) => (
          <IgnoredShowRow key={show.id} show={show} />
        ))}
      </ul>
    </PageSection>
  )
}

function IgnoredShowRow({ show }: { show: IgnoredShow }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  async function unignore() {
    setSaving(true)
    try {
      await ignoreShow({ data: { showId: show.id, ignored: false } })
      await router.invalidate()
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="flex items-center gap-3 py-3">
      {show.imageUrl ? (
        <img src={imageSrc(show.imageUrl, 80)} alt="" className="size-10 rounded-md object-cover" />
      ) : (
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <Icons.logo className="size-4 text-muted-foreground" />
        </div>
      )}
      <Link to="/$user/$show" params={showParams(show)} className="min-w-0 flex-1 truncate font-medium hover:underline">
        {show.title}
      </Link>
      <Button variant="outline" size="sm" disabled={saving} onClick={() => void unignore()}>
        <Icons.show />
        Stop ignoring
      </Button>
    </li>
  )
}
