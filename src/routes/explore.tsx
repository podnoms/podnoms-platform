import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { EpisodeListEnd } from '~/components/episode-list-end'
import { Icons } from '~/components/icons'
import { ListenerEpisodeList } from '~/components/listener-episode-list'
import { PodcastGrid } from '~/components/podcast-card'
import { PageHeading, PageSection } from '~/components/page-section'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import {
  explorePodcastPageSize,
  fetchExplore,
  fetchMoreExplorePodcasts,
  fetchMoreLatestEpisodes,
} from '~/functions/library'
import { useEpisodePages } from '~/hooks/use-episode-pages'
import { siteHead } from '~/lib/page-meta'
import { siteInfo } from '~/lib/site'

const description = 'Find podcasts to listen to on podnoms: popular episodes, shows and what came out lately.'

// The site's public podcasts, for anyone to browse: what's popular, the shows,
// and the newest episodes. Private podcasts and episodes are never here.
export const Route = createFileRoute('/explore')({
  loader: () => fetchExplore(),
  head: ({ matches }) => {
    const site = siteInfo(matches)
    if (!site?.origin) return { meta: [{ title: 'Explore · podnoms' }] }
    return siteHead({ origin: site.origin, path: '/explore', title: 'Explore podcasts · podnoms', description })
  },
  component: ExplorePage,
})

function ExplorePage() {
  const { popular, podcasts: firstShows, podcastCount, latest } = Route.useLoaderData()
  const [moreShows, setMoreShows] = useState<typeof firstShows>([])
  const [loadingShows, setLoadingShows] = useState(false)
  const shows = [...firstShows, ...moreShows.filter((show) => !firstShows.some((first) => first.id === show.id))]
  const episodes = useEpisodePages({
    podcastSlug: 'explore',
    first: latest,
    // No count is kept; a short page means the end.
    total: Number.POSITIVE_INFINITY,
    fetchMore: (offset, limit) => fetchMoreLatestEpisodes({ data: { offset, limit } }),
  })

  async function loadMoreShows() {
    setLoadingShows(true)
    try {
      const page = await fetchMoreExplorePodcasts({ data: { offset: shows.length, limit: explorePodcastPageSize } })
      setMoreShows((loaded) => [...loaded, ...page])
    } finally {
      setLoadingShows(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 p-4 md:p-8">
      <PageHeading icon={<Icons.explore />} title="Explore" description="Podcasts made on podnoms, for anyone to listen to." />
      {podcastCount === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.logo />
            </EmptyMedia>
            <EmptyTitle>Nothing to explore yet</EmptyTitle>
            <EmptyDescription>Public podcasts show up here once they have episodes.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {popular.length > 0 && (
            <PageSection title="Popular this month" description="The most liked episodes of the last 30 days.">
              <ListenerEpisodeList episodes={popular} />
            </PageSection>
          )}
          <PageSection title="Shows" count={podcastCount}>
            <PodcastGrid podcasts={shows} />
            {shows.length < podcastCount && (
              <Button variant="outline" className="self-center" disabled={loadingShows} onClick={loadMoreShows}>
                {loadingShows ? 'Loading…' : 'Show more'}
              </Button>
            )}
          </PageSection>
          <PageSection title="Latest episodes">
            <ListenerEpisodeList episodes={episodes.episodes} />
            <EpisodeListEnd {...episodes} />
          </PageSection>
        </>
      )}
    </div>
  )
}
