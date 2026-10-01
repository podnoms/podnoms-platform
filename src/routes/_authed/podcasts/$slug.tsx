import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { EditDetailsDialog } from '~/components/edit-details-dialog'
import { EpisodeRow } from '~/components/episode-row'
import { FeedUrlButton } from '~/components/feed-url-button'
import { Icons } from '~/components/icons'
import { NewEpisodeDialog } from '~/components/new-episode-dialog'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { ItemGroup } from '~/components/ui/item'
import { fetchMyPodcast, updateMyPodcast } from '~/functions/podcasts'
import { formatLength } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { htmlToText } from '~/lib/rich-text'

export const Route = createFileRoute('/_authed/podcasts/$slug')({
  loader: ({ params }) => fetchMyPodcast({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({ meta: loaderData ? [{ title: `${loaderData.title} · podnoms` }] : [] }),
  component: PodcastPage,
})

// While episodes are being processed, refresh this page every second.
function usePollWhileProcessing(active: boolean) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      void router.invalidate({ filter: (match) => match.routeId === Route.id })
    }, 1000)
    return () => clearInterval(timer)
  }, [active, router])
}

function PodcastPage() {
  const podcast = Route.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const { episodes } = podcast
  usePollWhileProcessing(episodes.some((e) => e.status === 'pending' || e.status === 'processing'))

  const ready = episodes.filter((e) => e.status === 'ready')
  const totalSeconds = ready.reduce((sum, e) => sum + (e.durationSeconds ?? 0), 0)
  const artwork = podcast.imageUrl ?? ready.find((e) => e.imageUrl)?.imageUrl ?? null
  const stats = [
    `${episodes.length} ${episodes.length === 1 ? 'episode' : 'episodes'}`,
    totalSeconds ? formatLength(totalSeconds) : null,
  ].filter(Boolean)

  const newEpisodeButton = (
    <NewEpisodeDialog podcastId={podcast.id}>
      <Button>
        <Icons.add />
        New episode
      </Button>
    </NewEpisodeDialog>
  )

  return (
    <div className="flex w-full max-w-5xl flex-col gap-8 p-4 md:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        {artwork ? (
          <img src={imageSrc(artwork, 112)} alt="" className="size-28 shrink-0 rounded-xl object-cover shadow-sm" />
        ) : (
          <div className="flex size-28 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Icons.logo className="size-10 text-muted-foreground" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Podcast</p>
          <h1 className="text-3xl font-semibold tracking-tight">{podcast.title}</h1>
          {podcast.description && (
            <p className="line-clamp-2 text-muted-foreground">{htmlToText(podcast.description)}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-4">
            <p className="text-sm text-muted-foreground">{stats.join(' · ')}</p>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Icons.edit />
                Edit
              </Button>
              <FeedUrlButton feedUrl={podcast.feedUrl} />
              {episodes.length > 0 && newEpisodeButton}
            </div>
          </div>
        </div>
      </header>
      <EditDetailsDialog
        open={editing}
        onOpenChange={setEditing}
        heading="Edit podcast"
        description="Changes show in podcast apps the next time they check the feed. The feed URL stays the same."
        details={{ title: podcast.title, description: podcast.description, imageUrl: podcast.imageUrl }}
        maxTitleLength={100}
        onSave={async (change) => {
          await updateMyPodcast({ data: { id: podcast.id, ...change } })
          await router.invalidate()
        }}
      />
      {episodes.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.logo />
            </EmptyMedia>
            <EmptyTitle>No episodes yet</EmptyTitle>
            <EmptyDescription>
              Paste a YouTube link or upload an audio file, and podnoms will turn it into an episode.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{newEpisodeButton}</EmptyContent>
        </Empty>
      ) : (
        <ItemGroup className="gap-3">
          {episodes.map((episode) => (
            <EpisodeRow key={episode.id} episode={episode} podcastSlug={podcast.slug} podcastTitle={podcast.title} />
          ))}
        </ItemGroup>
      )}
    </div>
  )
}
