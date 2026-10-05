import { createFileRoute, Link } from '@tanstack/react-router'
import { EpisodeListEnd } from '~/components/episode-list-end'
import { FeedUrlButton } from '~/components/feed-url-button'
import { Icons } from '~/components/icons'
import { PublicEpisodeRow } from '~/components/public-episode-row'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { ItemGroup } from '~/components/ui/item'
import { fetchPodcastEpisodes, fetchPodcastPage } from '~/functions/public'
import { useEpisodePages } from '~/hooks/use-episode-pages'
import { formatDate, formatLength } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { publicPageHead } from '~/lib/page-meta'
import { htmlToText } from '~/lib/rich-text'

// A podcast's public page, which anyone can visit. Its owner manages it at
// /podcasts/:slug/manage.
export const Route = createFileRoute('/podcasts/$slug')({
  staticData: { headerless: true },
  loader: ({ params }) => fetchPodcastPage({ data: { slug: params.slug } }),
  head: ({ loaderData: podcast }) =>
    podcast
      ? publicPageHead({
          title: podcast.title,
          description: podcast.description,
          url: podcast.pageUrl,
          imageUrl: podcast.previewImageUrl,
          type: 'website',
          feedUrl: podcast.feedUrl,
          feedTitle: podcast.title,
          noindex: podcast.private,
        })
      : {},
  component: PodcastPage,
})

function PodcastPage() {
  const podcast = Route.useLoaderData()
  const { summary } = podcast
  const { totalSeconds, latestAt } = summary
  const { episodes, ...more } = useEpisodePages({
    podcastSlug: podcast.slug,
    first: podcast.episodes,
    total: summary.count,
    fetchMore: (offset, limit) => fetchPodcastEpisodes({ data: { slug: podcast.slug, offset, limit } }),
  })
  const stats = [
    podcast.author ? `by ${podcast.author}` : null,
    `${summary.count} ${summary.count === 1 ? 'episode' : 'episodes'}`,
    totalSeconds ? formatLength(totalSeconds) : null,
  ].filter(Boolean)

  return (
    <div className="flex w-full flex-col">
      {/* The artwork, blurred, tints the header so the page reads as the show's. */}
      <header className="relative isolate overflow-hidden border-b">
        {podcast.imageUrl && (
          <img
            src={imageSrc(podcast.imageUrl, 112)}
            alt=""
            aria-hidden
            className="absolute inset-0 -z-10 size-full scale-125 object-cover opacity-50 blur-3xl saturate-150"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-linear-to-b from-background/20 to-background" />
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:flex-row sm:items-end md:p-8">
          {podcast.imageUrl ? (
            <img
              src={imageSrc(podcast.imageUrl, 192)}
              alt=""
              className="size-40 shrink-0 rounded-xl object-cover shadow-xl ring-1 ring-black/10 sm:size-48"
            />
          ) : (
            <div className="flex size-40 shrink-0 items-center justify-center rounded-xl bg-muted shadow-xl sm:size-48">
              <Icons.logo className="size-12 text-muted-foreground" />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Podcast</p>
            <h1 className="text-3xl font-bold tracking-tight text-balance md:text-5xl">{podcast.title}</h1>
            {/* On wide screens the full description is in the About column instead. */}
            {podcast.description && (
              <p className="line-clamp-2 max-w-3xl text-muted-foreground xl:hidden">{htmlToText(podcast.description)}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-3">
              <p className="text-sm text-muted-foreground">{stats.join(' · ')}</p>
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                {podcast.isOwner && (
                  <Button variant="outline" asChild>
                    <Link to="/podcasts/$slug/manage" params={{ slug: podcast.slug }}>
                      <Icons.settings />
                      Manage
                    </Link>
                  </Button>
                )}
                <FeedUrlButton feedUrl={podcast.feedUrl} label="Subscribe" />
              </div>
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-7xl items-start gap-8 p-4 md:p-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="episodes-heading" className="flex min-w-0 flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <h2 id="episodes-heading" className="text-lg font-semibold">
              Episodes
            </h2>
            {summary.count > 0 && <span className="text-sm text-muted-foreground">{summary.count}</span>}
          </div>
          {episodes.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icons.logo />
                </EmptyMedia>
                <EmptyTitle>No episodes yet</EmptyTitle>
                <EmptyDescription>Subscribe to hear new episodes as soon as they're out.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-3">
              {episodes.map((episode) => (
                <PublicEpisodeRow
                  key={episode.id}
                  episode={episode}
                  podcastSlug={podcast.slug}
                  podcastTitle={podcast.title}
                  podcastImageUrl={podcast.imageUrl}
                />
              ))}
            </ItemGroup>
          )}
          <EpisodeListEnd {...more} />
        </section>
        <aside className="sticky top-[calc(var(--top-nav-height,0px)+1rem)] hidden flex-col gap-6 rounded-xl border bg-card p-5 xl:flex">
          {podcast.description && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">About</h2>
              {/* Sanitised on the server (see rich-text.server.ts). */}
              <div
                className="rich-text text-sm text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: podcast.description }}
              />
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {podcast.author && (
              <>
                <dt className="text-muted-foreground">By</dt>
                <dd className="text-end">{podcast.author}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Episodes</dt>
            <dd className="text-end">{summary.count}</dd>
            {totalSeconds > 0 && (
              <>
                <dt className="text-muted-foreground">Total length</dt>
                <dd className="text-end">{formatLength(totalSeconds)}</dd>
              </>
            )}
            {latestAt && (
              <>
                <dt className="text-muted-foreground">Latest episode</dt>
                <dd className="text-end">{formatDate(latestAt)}</dd>
              </>
            )}
          </dl>
        </aside>
      </div>
    </div>
  )
}
