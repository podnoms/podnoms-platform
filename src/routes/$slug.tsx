import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { EpisodeListEnd } from '~/components/episode-list-end'
import { FeedUrlButton } from '~/components/feed-url-button'
import { FollowButton } from '~/components/follow-button'
import { Icons } from '~/components/icons'
import { PublicEpisodeList, PublicEpisodeRow } from '~/components/public-episode-row'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { fetchPodcastEpisodes, fetchPodcastPage } from '~/functions/public'
import { useEpisodePages } from '~/hooks/use-episode-pages'
import { useLiveStart } from '~/hooks/use-live-events'
import { formatDate, formatLength, pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { directories } from '~/lib/podcast-directories'
import { publicPageHead } from '~/lib/page-meta'
import { htmlToText } from '~/lib/rich-text'
import { jsonLdMeta, podcastSeriesJsonLd } from '~/lib/structured-data'

// A podcast's public page, at /:slug, which anyone can visit. Its owner
// manages it at /:slug/manage. Static routes win over this one, which is why
// slugs can't be any of reservedPodcastSlugs (src/lib/paths.ts).
export const Route = createFileRoute('/$slug')({
  staticData: { publicPage: true },
  loader: ({ params }) => fetchPodcastPage({ data: { slug: params.slug } }),
  head: ({ loaderData: podcast }) => {
    if (!podcast) return {}
    const head = publicPageHead({
      title: podcast.title,
      description: podcast.description,
      fallbackDescription: podcast.author ? `A podcast by ${podcast.author}` : `${podcast.title}, a podcast on podnoms`,
      url: podcast.pageUrl,
      image: podcast.previewImage,
      type: 'website',
      feedUrl: podcast.feedUrl,
      feedTitle: podcast.title,
      noindex: podcast.private,
    })
    // Unlisted podcasts aren't described to search engines.
    if (podcast.private) return head
    const jsonLd = podcastSeriesJsonLd({
      ...podcast,
      image: podcast.previewImage?.url ?? null,
      listings: Object.values(podcast.directoryLinks),
    })
    return { ...head, meta: [...head.meta, jsonLdMeta(jsonLd)] }
  },
  component: PodcastPage,
})

function PodcastPage() {
  const podcast = Route.useLoaderData()
  const navigate = useNavigate()
  // When a broadcast starts, visitors are taken to it. One that's already on
  // when the page opens only gets the Watch live button, so the episodes can
  // still be reached.
  const live = useLiveStart(podcast.slug, podcast.liveEnabled, podcast.live, () =>
    navigate({ to: '/live/$slug', params: { slug: podcast.slug } }),
  )
  const { summary } = podcast
  const { totalSeconds, latestAt } = summary
  const { episodes, ...more } = useEpisodePages({
    podcastSlug: podcast.slug,
    first: podcast.episodes,
    total: summary.count,
    fetchMore: (offset, limit) => fetchPodcastEpisodes({ data: { slug: podcast.slug, offset, limit } }),
  })
  // The directories it's listed on, in the order they're offered to owners.
  const listings = directories.flatMap((directory) => {
    const link = podcast.directoryLinks[directory.id]
    return link ? [{ directory, link }] : []
  })
  const stats = [
    podcast.author ? `by ${podcast.author}` : null,
    `${summary.count} ${summary.count === 1 ? 'episode' : 'episodes'}`,
    totalSeconds ? formatLength(totalSeconds) : null,
    podcast.followerCount > 0 ? pluralise(podcast.followerCount, 'follower') : null,
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
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Podcast</p>
              {live && (
                <Badge className="bg-destructive text-destructive-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-destructive-foreground" />
                  Live now
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-balance md:text-5xl">{podcast.title}</h1>
            {/* On wide screens the full description is in the About column instead. */}
            {podcast.description && (
              <p className="line-clamp-2 max-w-3xl text-muted-foreground xl:hidden">{htmlToText(podcast.description)}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-3">
              <p className="text-sm text-muted-foreground">{stats.join(' · ')}</p>
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                {live && (
                  <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" asChild>
                    <Link to="/live/$slug" params={{ slug: podcast.slug }}>
                      <Icons.broadcast />
                      Watch live
                    </Link>
                  </Button>
                )}
                {podcast.isOwner && (
                  <Button variant="outline" asChild>
                    <Link to="/$slug/manage" params={{ slug: podcast.slug }}>
                      <Icons.settings />
                      Manage
                    </Link>
                  </Button>
                )}
                {/* Owners don't follow their own podcasts; it's in their sidebar already. */}
                {!podcast.isOwner && <FollowButton podcastId={podcast.id} following={podcast.following} />}
                <FeedUrlButton feedUrl={podcast.feedUrl} label="Subscribe" />
              </div>
            </div>
            {listings.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Listen on</span>
                {listings.map(({ directory, link }) => (
                  <Button key={directory.id} variant="secondary" size="sm" asChild>
                    <a href={link} target="_blank" rel="noreferrer">
                      {directory.name}
                    </a>
                  </Button>
                ))}
              </div>
            )}
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
            <PublicEpisodeList>
              {episodes.map((episode) => (
                <PublicEpisodeRow
                  key={episode.id}
                  episode={episode}
                  podcastSlug={podcast.slug}
                  podcastTitle={podcast.title}
                  podcastImageUrl={podcast.imageUrl}
                  isOwner={podcast.isOwner}
                />
              ))}
            </PublicEpisodeList>
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
            <dt className="text-muted-foreground">Followers</dt>
            <dd className="text-end">{podcast.followerCount}</dd>
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
