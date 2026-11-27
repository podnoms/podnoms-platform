import { useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { EditDetailsDialog } from '~/components/edit-details-dialog'
import { EpisodeListEnd } from '~/components/episode-list-end'
import { EpisodeTitleSearchBox, useEpisodeTitleSearch } from '~/components/episode-title-search'
import { AuthorLink, Separated } from '~/components/author-link'
import { FeedUrlButton } from '~/components/feed-url-button'
import { FollowButton } from '~/components/follow-button'
import { ReportImageButton } from '~/components/report-image-button'
import { Icons } from '~/components/icons'
import { PublicEpisodeList, PublicEpisodeRow } from '~/components/public-episode-row'
import { TagList } from '~/components/tag-list'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { fetchShowEpisodes, fetchShowPage } from '~/functions/public'
import { setMyShowPrivacy, updateMyShow } from '~/functions/shows'
import { useEpisodePages } from '~/hooks/use-episode-pages'
import { episodePageSize } from '~/lib/episode-pages'
import { useLiveStart } from '~/hooks/use-live-events'
import { isCustomDomain } from '~/lib/current-domain'
import { formatDate, formatLength, pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { showByline } from '~/lib/byline'
import { showParams } from '~/lib/paths'
import { directories } from '~/lib/podcast-directories'
import { publicPageHead } from '~/lib/page-meta'
import { htmlToText } from '~/lib/rich-text'
import { showThemeHead } from '~/lib/app-shell'
import { jsonLdMeta, showSeriesJsonLd } from '~/lib/structured-data'
import { brandingFrom } from '~/lib/branding'

// A show's public page, at /<owner>/<show>, which anyone can visit. Its owner
// manages it at .../manage. Static routes win over this one, which is why
// slugs can't be any of reservedShowSlugs (src/lib/paths.ts).
export const Route = createFileRoute('/$user_/$show')({
  staticData: { publicPage: true },
  loader: ({ params }) => fetchShowPage({ data: params }),
  head: ({ loaderData: show, matches }) => {
    if (!show) return {}
    const branding = brandingFrom(matches)
    const head = publicPageHead({
      site: branding,
      title: show.title,
      description: show.description,
      fallbackDescription: isCustomDomain()
        ? show.title
        : show.author
          ? `A show by ${show.author}`
          : `${show.title}, a show on ${branding.name}`,
      url: show.pageUrl,
      image: show.previewImage,
      type: 'website',
      feedUrl: show.feedUrl,
      feedTitle: show.title,
      noindex: show.private,
    })
    const theme = showThemeHead(matches, show.theme)
    const themed = { ...head, links: [...head.links, ...theme.links], styles: theme.styles }
    // Unlisted shows aren't described to search engines.
    if (show.private) return themed
    const jsonLd = showSeriesJsonLd({
      ...show,
      image: show.previewImage?.url ?? null,
      listings: Object.values(show.directoryLinks),
    })
    return { ...themed, meta: [...head.meta, jsonLdMeta(jsonLd)] }
  },
  component: ShowPage,
})

function ShowPage() {
  const show = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  // The owner edits the show's details here, rather than on its manage page.
  const [editing, setEditing] = useState(false)
  // A show's own domain stands alone: it has no accounts, so no followers or
  // owner's controls, and doesn't name the author.
  const onDomain = isCustomDomain()
  // When a broadcast starts, visitors are taken to it. One that's already on
  // when the page opens only gets the Watch live button, so the episodes can
  // still be reached.
  const live = useLiveStart(show.id, show.liveEnabled, show.live, () =>
    navigate({ to: '/$user/$show/live', params: showParams(show) }),
  )
  const { summary } = show
  const { totalSeconds, latestAt } = summary
  const { episodes, ...more } = useEpisodePages({
    showKey: show.id,
    first: show.episodes,
    total: summary.count,
    fetchMore: (offset, limit) => fetchShowEpisodes({ data: { showId: show.id, offset, limit } }),
  })
  // Searching the episodes' titles, which shows the matches in place of the list.
  const [titleQuery, setTitleQuery] = useState('')
  const search = useEpisodeTitleSearch(titleQuery, (query, offset, limit) =>
    fetchShowEpisodes({ data: { showId: show.id, offset, limit, titleQuery: query } }),
  )
  const shown = search.active ? search.episodes : episodes
  // The directories it's listed on, in the order they're offered to owners.
  const listings = directories.flatMap((directory) => {
    const link = show.directoryLinks[directory.id]
    return link ? [{ directory, link }] : []
  })
  const stats = [
    !onDomain ? <AuthorLink key="by" credit={show.credit} slug={show.ownerSlug} /> : null,
    `${summary.count} ${summary.count === 1 ? 'episode' : 'episodes'}`,
    totalSeconds ? formatLength(totalSeconds) : null,
    show.followerCount > 0 && !onDomain ? pluralise(show.followerCount, 'follower') : null,
  ].filter(Boolean)

  return (
    <div className="flex w-full flex-col">
      {/* The artwork, blurred, tints the header so the page reads as the show's. */}
      <header className="relative isolate overflow-hidden border-b">
        {show.imageUrl && (
          <img
            src={imageSrc(show.imageUrl, 112)}
            alt=""
            aria-hidden
            className="absolute inset-0 -z-10 size-full scale-125 object-cover opacity-50 blur-3xl saturate-150"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-linear-to-b from-background/20 to-background" />
        <div className="mx-auto flex w-full max-w-page flex-col gap-6 p-4 sm:flex-row sm:items-end md:p-8">
          {show.imageUrl ? (
            <img
              src={imageSrc(show.imageUrl, 192)}
              alt=""
              className="size-40 shrink-0 rounded-xl object-cover shadow-xl ring-1 ring-black/10 sm:size-48"
            />
          ) : (
            <div className="flex size-40 shrink-0 items-center justify-center rounded-xl bg-muted shadow-xl sm:size-48">
              <Icons.logo className="size-12 text-muted-foreground" />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {live && (
              <div className="flex items-center gap-2">
                <Badge className="bg-destructive text-destructive-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-destructive-foreground" />
                  Live now
                </Badge>
              </div>
            )}
            <h1 className="text-3xl font-bold tracking-tight text-balance md:text-5xl">{show.title}</h1>
            <TagList tags={show.tags} />
            {/* On wide screens the full description is in the About column instead. */}
            {show.description && (
              <p className="line-clamp-2 max-w-3xl text-muted-foreground xl:hidden">{htmlToText(show.description)}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
                <p className="text-sm text-muted-foreground">
                  <Separated items={stats} />
                </p>
                {/* Only worth it once there's more than a page of episodes. */}
                {summary.count > episodePageSize && (
                  <EpisodeTitleSearchBox value={titleQuery} onChange={setTitleQuery} />
                )}
              </div>
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                {live && (
                  <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" asChild>
                    <Link to="/$user/$show/live" params={showParams(show)}>
                      <Icons.broadcast />
                      Watch live
                    </Link>
                  </Button>
                )}
                {show.isOwner && !onDomain && (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Icons.edit />
                    Edit
                  </Button>
                )}
                {/* Owners don't follow their own shows; it's in their sidebar already. */}
                {!show.isOwner && <FollowButton showId={show.id} following={show.following} />}
                <FeedUrlButton feedUrl={show.feedUrl} label="Subscribe" />
                {show.imageUrl && !show.isOwner && <ReportImageButton targetKind="show" targetId={show.id} />}
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
      <div className="mx-auto grid w-full max-w-page items-start gap-8 p-4 md:p-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Episodes" className="flex min-w-0 flex-col gap-3">
          {search.active ? (
            search.failed ? (
              <p className="py-6 text-center text-sm text-destructive">Searching failed. Please try again.</p>
            ) : search.settled && shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No episode titles match “{search.query}”.</p>
            ) : null
          ) : null}
          {search.active ? (
            <>
              {shown.length > 0 && (
                <PublicEpisodeList>
                  {shown.map((episode) => (
                    <PublicEpisodeRow
                      key={episode.id}
                      episode={episode}
                      show={show}
                      showTitle={show.title}
                      showImageUrl={show.imageUrl}
                      isOwner={show.isOwner}
                    />
                  ))}
                </PublicEpisodeList>
              )}
              {search.loading && (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                  <Spinner /> Searching…
                </div>
              )}
              {search.hasMore && !search.loading && (
                <Button variant="outline" className="self-center" onClick={search.loadMore}>
                  More matches
                </Button>
              )}
            </>
          ) : episodes.length === 0 ? (
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
                  show={show}
                  showTitle={show.title}
                  showImageUrl={show.imageUrl}
                  isOwner={show.isOwner}
                />
              ))}
            </PublicEpisodeList>
          )}
          {!search.active && <EpisodeListEnd {...more} />}
        </section>
        <aside className="sticky top-[calc(var(--top-nav-height,0px)+1rem)] hidden flex-col gap-6 rounded-xl border bg-card p-5 xl:flex">
          {show.description && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">About</h2>
              {/* Sanitised on the server (see rich-text.server.ts). */}
              <div
                className="rich-text text-sm text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: show.description }}
              />
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {!onDomain && (
              <>
                <dt className="text-muted-foreground">By</dt>
                <dd className="text-end">
                  <Link to="/$user" params={{ user: show.ownerSlug }} className="hover:text-primary hover:underline">
                    {showByline(show)}
                  </Link>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Episodes</dt>
            <dd className="text-end">{summary.count}</dd>
            {!onDomain && (
              <>
                <dt className="text-muted-foreground">Followers</dt>
                <dd className="text-end">{show.followerCount}</dd>
              </>
            )}
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
      {show.isOwner && !onDomain && (
        <EditDetailsDialog
          open={editing}
          onOpenChange={setEditing}
          heading="Edit show"
          description="Changes show in podcast apps the next time they check the feed."
          details={{
            title: show.title,
            description: show.description,
            imageUrl: show.imageUrl,
            tags: show.tags,
            slug: show.slug,
            slugPrefix: `${show.ownerSlug}/`,
            private: show.private,
            kind: 'show',
          }}
          maxTitleLength={100}
          onSave={async ({ private: makePrivate, ...change }) => {
            const result = await updateMyShow({ data: { id: show.id, ...change } })
            if (result.error) return result.error
            if (makePrivate !== undefined) await setMyShowPrivacy({ data: { id: show.id, private: makePrivate } })
            // To the new address first, as the old one has gone.
            if (change.slug) await navigate({ to: '/$user/$show', params: showParams({ ...show, slug: change.slug }), replace: true })
            // The sidebar's shows are reloaded too, for their links.
            await router.invalidate()
          }}
        />
      )}
    </div>
  )
}
