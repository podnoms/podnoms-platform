import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { EpisodeListEnd } from '~/components/episode-list-end'
import { Icons } from '~/components/icons'
import { ListenerEpisodeList } from '~/components/listener-episode-list'
import { ShowGrid } from '~/components/show-card'
import { PageHeading, PageSection } from '~/components/page-section'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import {
  exploreShowPageSize,
  fetchExplore,
  fetchMoreExploreShows,
  fetchMoreLatestEpisodes,
} from '~/functions/library'
import { useEpisodePages } from '~/hooks/use-episode-pages'
import { siteHead } from '~/lib/page-meta'
import { siteInfo } from '~/lib/site'
import { brandingFrom, useBranding, withSiteName } from '~/lib/branding'

const description = 'Find something to listen to on {name}: popular episodes, shows and what came out lately.'

// The site's public shows, for anyone to browse: what's popular, the shows,
// and the newest episodes. Private shows and episodes are never here.
export const Route = createFileRoute('/explore')({
  loader: () => fetchExplore(),
  head: ({ matches }) => {
    const site = siteInfo(matches)
    const branding = brandingFrom(matches)
    if (!site?.origin) return { meta: [{ title: `Explore · ${branding.name}` }] }
    return siteHead({
      site: branding,
      origin: site.origin,
      path: '/explore',
      title: `Explore shows · ${branding.name}`,
      description: withSiteName(description, branding),
    })
  },
  component: ExplorePage,
})

function ExplorePage() {
  const { popular, shows: firstShows, showCount, latest } = Route.useLoaderData()
  const [moreShows, setMoreShows] = useState<typeof firstShows>([])
  const [loadingShows, setLoadingShows] = useState(false)
  const shows = [...firstShows, ...moreShows.filter((show) => !firstShows.some((first) => first.id === show.id))]
  const episodes = useEpisodePages({
    showSlug: 'explore',
    first: latest,
    // No count is kept; a short page means the end.
    total: Number.POSITIVE_INFINITY,
    fetchMore: (offset, limit) => fetchMoreLatestEpisodes({ data: { offset, limit } }),
  })

  const branding = useBranding()

  async function loadMoreShows() {
    setLoadingShows(true)
    try {
      const page = await fetchMoreExploreShows({ data: { offset: shows.length, limit: exploreShowPageSize } })
      setMoreShows((loaded) => [...loaded, ...page])
    } finally {
      setLoadingShows(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 p-4 md:p-8">
      <PageHeading
        icon={<Icons.explore />}
        title="Explore"
        description={`Shows made on ${branding.name}, for anyone to listen to.`}
      />
      {showCount === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.logo />
            </EmptyMedia>
            <EmptyTitle>Nothing to explore yet</EmptyTitle>
            <EmptyDescription>Public shows appear here once they have episodes.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {popular.length > 0 && (
            <PageSection title="Popular this month" description="The most liked episodes of the last 30 days.">
              <ListenerEpisodeList episodes={popular} />
            </PageSection>
          )}
          <PageSection title="Shows" count={showCount}>
            <ShowGrid shows={shows} />
            {shows.length < showCount && (
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
