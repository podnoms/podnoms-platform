import { useEffect } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { NewEpisodeDialog } from '~/components/new-episode-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '~/components/ui/item'
import { Progress } from '~/components/ui/progress'
import { Spinner } from '~/components/ui/spinner'
import { fetchMyPodcast } from '~/functions/podcasts'
import type { EpisodeStatus } from '~/server/db/schema'
import type { EpisodeProgress } from '~/server/episode-processor.server'

export const Route = createFileRoute('/_authed/podcasts/$slug')({
  loader: ({ params }) => fetchMyPodcast({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({ meta: loaderData ? [{ title: `${loaderData.title} · podnoms` }] : [] }),
  component: PodcastPage,
})

const statusLabels: Record<EpisodeStatus, string> = {
  pending: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
}

const stageLabels: Record<EpisodeProgress['stage'], string> = {
  queued: 'Queued',
  fetching: 'Fetching details',
  downloading: 'Downloading',
  converting: 'Converting',
}

// A fixed locale and time zone so server and browser render the same text.
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTimeLeft(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min left`
}

// A progress bar and one line of detail for an episode that's being processed.
function EpisodeProgressView({ progress }: { progress: EpisodeProgress | null }) {
  if (!progress) {
    return <p className="text-sm text-muted-foreground">Waiting for the server to pick this up…</p>
  }
  if (progress.stage === 'downloading') {
    const { downloadedBytes, totalBytes, bytesPerSecond, secondsLeft } = progress
    const percent = totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : null
    const detail = [
      totalBytes ? `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}` : formatBytes(downloadedBytes),
      bytesPerSecond ? `${formatBytes(bytesPerSecond)}/s` : null,
      secondsLeft != null ? formatTimeLeft(secondsLeft) : null,
    ].filter(Boolean)
    return (
      <div className="flex w-full flex-col gap-1.5">
        <div className="flex text-sm text-muted-foreground">
          <span>Downloading{percent != null && ` · ${Math.floor(percent)}%`}</span>
          <span className="ml-auto tabular-nums">{detail.join(' · ')}</span>
        </div>
        <Progress value={percent ?? 0} />
      </div>
    )
  }
  const text = {
    queued:
      progress.stage === 'queued' && progress.ahead > 0
        ? `Waiting to start · ${progress.ahead} ahead in the queue`
        : 'Starting…',
    fetching: 'Fetching video details…',
    converting: 'Downloaded · converting to MP3…',
  }[progress.stage]
  return (
    <div className="flex w-full flex-col gap-1.5">
      <p className="text-sm text-muted-foreground">{text}</p>
      <Progress value={progress.stage === 'converting' ? 100 : 0} />
    </div>
  )
}

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
  usePollWhileProcessing(podcast.episodes.some((e) => e.status === 'pending' || e.status === 'processing'))

  const newEpisodeButton = (
    <NewEpisodeDialog podcastId={podcast.id}>
      <Button>
        <Icons.add />
        New episode
      </Button>
    </NewEpisodeDialog>
  )

  return (
    <div className="flex flex-col gap-6 p-4">
      <header className="flex items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{podcast.title}</h1>
          {podcast.description && <p className="text-muted-foreground">{podcast.description}</p>}
        </div>
        {podcast.episodes.length > 0 && <div className="ml-auto">{newEpisodeButton}</div>}
      </header>
      {podcast.episodes.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.logo />
            </EmptyMedia>
            <EmptyTitle>No episodes yet</EmptyTitle>
            <EmptyDescription>Add your first episode from a YouTube link.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{newEpisodeButton}</EmptyContent>
        </Empty>
      ) : (
        <ItemGroup>
          {podcast.episodes.map((episode) => (
            <Item key={episode.id} variant="outline">
              {episode.imageUrl && (
                <ItemMedia variant="image">
                  <img src={episode.imageUrl} alt="" />
                </ItemMedia>
              )}
              <ItemContent>
                <ItemTitle>{episode.title}</ItemTitle>
                <ItemDescription>
                  Added {dateFormat.format(episode.createdAt)}
                  {episode.durationSeconds != null && ` · ${formatDuration(episode.durationSeconds)}`}
                  {episode.status === 'failed' && episode.error && ` · ${episode.error}`}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={episode.status === 'failed' ? 'destructive' : 'secondary'}>
                  {(episode.status === 'pending' || episode.status === 'processing') && <Spinner />}
                  {episode.progress ? stageLabels[episode.progress.stage] : statusLabels[episode.status]}
                </Badge>
              </ItemActions>
              {(episode.status === 'pending' || episode.status === 'processing') && (
                <ItemFooter>
                  <EpisodeProgressView progress={episode.progress} />
                </ItemFooter>
              )}
              {episode.status === 'ready' && episode.audioUrl && (
                <ItemFooter>
                  <audio controls preload="none" src={episode.audioUrl} className="w-full" />
                </ItemFooter>
              )}
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  )
}
