import { useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { ActivityPanel } from '~/components/activity-panel'
import { BulkUploadDialog } from '~/components/bulk-upload-dialog'
import { ChannelPanel } from '~/components/channel-panel'
import { CustomDomainCard } from '~/components/custom-domain-card'
import { DeletePodcastDialog } from '~/components/delete-podcast-dialog'
import { DistributionPanel } from '~/components/distribution-panel'
import { EditDetailsDialog } from '~/components/edit-details-dialog'
import { EpisodeListEnd } from '~/components/episode-list-end'
import { EpisodeRow } from '~/components/episode-row'
import { FeedUrlButton } from '~/components/feed-url-button'
import { Icons } from '~/components/icons'
import { GoLiveButton } from '~/components/go-live-dialog'
import { NewEpisodeDialog } from '~/components/new-episode-dialog'
import { PodcastPrivacyCard } from '~/components/podcast-privacy-card'
import { TagList } from '~/components/tag-list'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { ItemGroup } from '~/components/ui/item'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { fetchMyPodcast, fetchMyPodcastEpisodes, updateMyPodcast } from '~/functions/podcasts'
import { useEpisodePages } from '~/hooks/use-episode-pages'
import { useLiveProgress, withLiveProgress } from '~/hooks/use-episode-events'
import { useLiveStart } from '~/hooks/use-live-events'
import { formatDate, formatLength, pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { isReady } from '~/lib/podcast-directories'
import { htmlToText } from '~/lib/rich-text'
import { cn } from '~/lib/utils'
import { pageTitle, useBranding } from '~/lib/branding'

export const Route = createFileRoute('/_authed/$slug/manage')({
  loader: ({ params }) => fetchMyPodcast({ data: { slug: params.slug } }),
  head: ({ loaderData, matches }) => ({ meta: loaderData ? [{ title: pageTitle(matches, loaderData.title) }] : [] }),
  component: PodcastPage,
})

function PodcastPage() {
  const podcast = Route.useLoaderData()
  const branding = useBranding()
  const router = useRouter()
  const navigate = useNavigate()
  // Going live (from OBS) brings the owner to the live page, to watch and chat.
  const broadcasting = useLiveStart(podcast.slug, podcast.liveEnabled, podcast.live, () =>
    navigate({ to: '/live/$slug', params: { slug: podcast.slug } }),
  )
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { summary } = podcast
  const { totalSeconds, latestAt } = summary
  const { episodes: loaded, ...more } = useEpisodePages({
    podcastSlug: podcast.slug,
    first: podcast.episodes,
    total: summary.count,
    fetchMore: (offset, limit) => fetchMyPodcastEpisodes({ data: { slug: podcast.slug, offset, limit } }),
  })
  // Follow the podcast's episodes live (rather than polling) and reload the
  // page when one's details change or one is added, whether by a channel
  // check, the browser extension or another tab.
  const live = useLiveProgress(podcast.slug, true, podcast, () =>
    router.invalidate({ filter: (match) => match.routeId === Route.id }),
  )
  const episodes = loaded.map((episode) => withLiveProgress(episode, live))

  const artwork = podcast.imageUrl ?? episodes.find((e) => e.status === 'ready' && e.imageUrl)?.imageUrl ?? null
  const stats = [
    `${summary.count} ${summary.count === 1 ? 'episode' : 'episodes'}`,
    totalSeconds ? formatLength(totalSeconds) : null,
    podcast.followerCount > 0 ? pluralise(podcast.followerCount, 'follower') : null,
  ].filter(Boolean)

  // Square, label-less buttons below md, so the header's actions fit one row.
  const iconOnMobile = 'max-md:w-8 max-md:px-0'

  const newEpisodeButtons = (
    <>
      {/* Picking a folder of audio isn't something people do on a phone. */}
      <BulkUploadDialog podcastId={podcast.id}>
        <Button variant="outline" className="max-md:hidden">
          <Icons.uploadFolder />
          Upload folder
        </Button>
      </BulkUploadDialog>
      <NewEpisodeDialog podcastId={podcast.id} podcastTitle={podcast.title}>
        <Button>
          <Icons.add />
          New episode
        </Button>
      </NewEpisodeDialog>
    </>
  )

  return (
    <div className="flex w-full flex-col">
      {/* The artwork, blurred, tints the header so the page reads as the show's. */}
      <header className="relative isolate overflow-hidden border-b">
        {artwork && (
          <img
            src={imageSrc(artwork, 112)}
            alt=""
            aria-hidden
            className="absolute inset-0 -z-10 size-full scale-125 object-cover opacity-50 blur-3xl saturate-150"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-linear-to-b from-background/20 to-background" />
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:flex-row sm:items-end md:p-8">
          {artwork ? (
            <img
              src={imageSrc(artwork, 192)}
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
              {podcast.private && (
                <Badge variant="secondary">
                  <Icons.private />
                  Private
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-balance md:text-5xl">{podcast.title}</h1>
            <TagList tags={podcast.tags} />
            {/* On wide screens the full description is in the About column instead. */}
            {podcast.description && (
              <p className="line-clamp-2 max-w-3xl text-muted-foreground xl:hidden">{htmlToText(podcast.description)}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-3">
              <p className="text-sm text-muted-foreground">{stats.join(' · ')}</p>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {/* Nobody streams from OBS on a phone, so only a broadcast already on air shows there. */}
                {podcast.liveEnabled && (
                  <div className={cn('contents', !broadcasting && 'max-md:hidden')}>
                    <GoLiveButton podcast={podcast} live={broadcasting} />
                  </div>
                )}
                <Button variant="outline" className={iconOnMobile} onClick={() => setEditing(true)}>
                  <Icons.edit />
                  <span className="max-md:sr-only">Edit</span>
                </Button>
                <Button variant="outline" className={iconOnMobile} asChild>
                  <Link to="/$slug" target='_blank' params={{ slug: podcast.slug }} >
                    <Icons.externalLink />
                    <span className="max-md:sr-only">Public page</span>
                  </Link>
                </Button>
                <FeedUrlButton
                  feedUrl={podcast.feedUrl}
                  label={podcast.private ? 'Private RSS URL' : undefined}
                  iconOnMobile
                />
                {episodes.length > 0 && newEpisodeButtons}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Icons.more />
                      <span className="sr-only">Podcast actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto">
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                      <Icons.delete />
                      Delete podcast
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-7xl items-start gap-8 p-4 md:p-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {podcast.channel && <ChannelPanel podcastId={podcast.id} channel={podcast.channel} />}
          {/* Activity is a tab away, so the episodes stay the focus. */}
          <Tabs defaultValue="episodes" className="min-w-0 gap-3">
            <TabsList variant="line">
              <TabsTrigger value="episodes">
                Episodes
                {summary.count > 0 && <span className="text-muted-foreground tabular-nums">{summary.count}</span>}
              </TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="distribution">
                Distribution
                {!isReady(podcast.distribution.readiness) && <span className="size-1.5 rounded-full bg-destructive" />}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="episodes" className="flex flex-col gap-3">
              {episodes.length === 0 ? (
                <Empty className="border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Icons.logo />
                    </EmptyMedia>
                    <EmptyTitle>No episodes yet</EmptyTitle>
                    <EmptyDescription>
                      {podcast.channel
                        ? "The channel's uploads appear here as they're found. You can add episodes of your own too."
                        : `Paste a YouTube link or upload an audio file, and ${branding.name} will turn it into an episode.`}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className="flex-row flex-wrap justify-center">{newEpisodeButtons}</EmptyContent>
                </Empty>
              ) : (
                <ItemGroup className="gap-3">
                  {episodes.map((episode) => (
                    <EpisodeRow key={episode.id} episode={episode} podcastSlug={podcast.slug} podcastTitle={podcast.title} />
                  ))}
                </ItemGroup>
              )}
              <EpisodeListEnd {...more} />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityPanel slug={podcast.slug} />
            </TabsContent>
            <TabsContent value="distribution" className="flex flex-col gap-6">
              <PodcastPrivacyCard
                podcast={podcast}
                onChanged={() => router.invalidate({ filter: (match) => match.routeId === Route.id })}
              />
              <DistributionPanel
                podcast={podcast}
                distribution={podcast.distribution}
                onChanged={() => router.invalidate({ filter: (match) => match.routeId === Route.id })}
                onEditDetails={() => setEditing(true)}
              />
              {podcast.customDomainTarget && (
                <CustomDomainCard
                  podcast={podcast}
                  target={podcast.customDomainTarget}
                  txtLabel={podcast.customDomainTxtLabel}
                  onChanged={() => router.invalidate({ filter: (match) => match.routeId === Route.id })}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
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
      <DeletePodcastDialog
        podcast={{ id: podcast.id, title: podcast.title, slug: podcast.slug, episodeCount: summary.count }}
        open={deleting}
        onOpenChange={setDeleting}
      />
      <EditDetailsDialog
        open={editing}
        onOpenChange={setEditing}
        heading="Edit podcast"
        description="Changes show in podcast apps the next time they check the feed."
        details={{ title: podcast.title, description: podcast.description, imageUrl: podcast.imageUrl, tags: podcast.tags, slug: podcast.slug }}
        maxTitleLength={100}
        onSave={async (change) => {
          const result = await updateMyPodcast({ data: { id: podcast.id, ...change } })
          if (result.error) return result.error
          // To the new address first, as the old one has gone.
          if (change.slug) await navigate({ to: '/$slug/manage', params: { slug: change.slug }, replace: true })
          // The sidebar's podcasts are reloaded too, for their links.
          await router.invalidate()
        }}
      />
    </div>
  )
}
