import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { EpisodeListEnd } from '~/components/episode-list-end'
import { Icons } from '~/components/icons'
import { ListenerEpisodeList } from '~/components/listener-episode-list'
import { PageHeading } from '~/components/page-section'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { fetchTagEpisodes, fetchTagPage } from '~/functions/tags'
import { useEpisodePages } from '~/hooks/use-episode-pages'
import { pluralise } from '~/lib/format'
import { siteHead } from '~/lib/page-meta'
import { siteInfo } from '~/lib/site'
import { brandingFrom } from '~/lib/branding'

const searchSchema = z.object({ sort: z.enum(['newest', 'popular']).catch('newest') })

export const Route = createFileRoute('/tags/$tagSlug')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ sort: search.sort }),
  loader: ({ params, deps }) => fetchTagPage({ data: { tagSlug: params.tagSlug, sort: deps.sort } }),
  head: ({ loaderData, matches }) => {
    if (!loaderData) return {}
    const { tag } = loaderData
    const branding = brandingFrom(matches)
    const title = `${tag.name} mixes · ${branding.name}`
    const site = siteInfo(matches)
    if (!site?.origin) return { meta: [{ title }] }
    return siteHead({
      site: branding,
      origin: site.origin,
      path: `/tags/${encodeURIComponent(tag.slug)}`,
      title,
      description: `Listen to mixes tagged ${tag.name}, including episodes from shows with this tag.`,
    })
  },
  component: TagPage,
})

function TagPage() {
  const { tag, episodes: first, total } = Route.useLoaderData()
  const { sort } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { episodes, ...more } = useEpisodePages({
    // A different tag or ordering starts a fresh list.
    podcastSlug: `tag:${tag.id}:${sort}`,
    first,
    total,
    fetchMore: (offset, limit) => fetchTagEpisodes({ data: { tagSlug: tag.slug, sort, offset, limit } }),
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <PageHeading
        icon={<Icons.explore />}
        title={`#${tag.name}`}
        description="Mixes with this tag, including episodes from tagged shows."
      />
      <section aria-label="Tagged mixes" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{pluralise(total, 'mix', 'mixes')}</p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={sort}
            aria-label="Sort mixes"
            onValueChange={(value) => {
              if (value === 'newest' || value === 'popular') {
                void navigate({ search: (previous) => ({ ...previous, sort: value }), resetScroll: false })
              }
            }}
          >
            <ToggleGroupItem value="newest">Upload date</ToggleGroupItem>
            <ToggleGroupItem value="popular">Popularity</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {episodes.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icons.logo />
              </EmptyMedia>
              <EmptyTitle>No public mixes yet</EmptyTitle>
              <EmptyDescription>Public episodes with this tag, or from shows with this tag, will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ListenerEpisodeList episodes={episodes} />
        )}
        <EpisodeListEnd {...more} />
      </section>
    </div>
  )
}
