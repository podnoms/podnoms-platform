import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { EditDetailsDialog } from '~/components/edit-details-dialog'
import { EpisodeProgress, stageLabels } from '~/components/episode-progress'
import { Icons } from '~/components/icons'
import { usePlayer } from '~/components/player/player-provider'
import { ReplaceAudioDialog } from '~/components/replace-audio-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '~/components/ui/item'
import { Spinner } from '~/components/ui/spinner'
import { deleteMyEpisode, dismissMyEpisodeError, retryMyEpisode, updateMyEpisode } from '~/functions/podcasts'
import { formatClock, formatDate, hostname } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { htmlToText } from '~/lib/rich-text'
import type { EpisodeStatus } from '~/server/db/schema'
import type { EpisodeProgress as ProgressInfo } from '~/server/episode-processor.server'

export type EpisodeRowData = {
  id: string
  title: string
  slug: string
  description: string | null
  sourceUrl: string | null
  imageUrl: string | null
  audioUrl: string | null
  durationSeconds: number | null
  status: EpisodeStatus
  error: string | null
  replacing: boolean
  createdAt: Date
  positionSeconds: number | null
  progress: ProgressInfo | null
}

export function EpisodeRow({
  episode,
  podcastSlug,
  podcastTitle,
}: {
  episode: EpisodeRowData
  podcastSlug: string
  podcastTitle: string
}) {
  const router = useRouter()
  const player = usePlayer()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [replacingAudio, setReplacingAudio] = useState(false)
  const [busy, setBusy] = useState(false)

  const inProgress = episode.status === 'pending' || episode.status === 'processing'
  const isCurrent = player.episode?.id === episode.id
  const isPlaying = isCurrent && player.playing

  const position = isCurrent ? player.currentTime : player.positionOf(episode.id, episode.positionSeconds)
  const length = (isCurrent && player.duration) || episode.durationSeconds || 0
  const played = length > 0 && position > 0 ? Math.min(position / length, 1) : 0

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  function play() {
    if (!episode.audioUrl) return
    player.play({
      id: episode.id,
      title: episode.title,
      audioUrl: episode.audioUrl,
      imageUrl: episode.imageUrl,
      podcastTitle,
      slug: episode.slug,
      podcastSlug,
      isOwner: true,
      positionSeconds: episode.positionSeconds,
    })
  }

  // The source's title isn't known until it's fetched; show where it's from meanwhile.
  const title = episode.title === episode.sourceUrl ? `Episode from ${hostname(episode.title)}` : episode.title
  const meta = [
    formatDate(episode.createdAt),
    episode.durationSeconds != null ? formatClock(episode.durationSeconds) : null,
    episode.sourceUrl ? hostname(episode.sourceUrl) : null,
  ].filter(Boolean)

  return (
    // A row of the podcast page's episode list, drawn as its own card. The
    // playing episode gets an accent bar.
    <Item
      role="listitem"
      data-current={isCurrent || undefined}
      className="relative gap-5 overflow-hidden rounded-xl border bg-card p-4 transition-colors before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary before:opacity-0 hover:bg-muted/50 data-current:border-primary/40 data-current:bg-primary/5 data-current:before:opacity-100 sm:p-5"
    >
      <ItemMedia variant="image" className="relative size-20 rounded-lg">
        {episode.imageUrl ? (
          <img src={imageSrc(episode.imageUrl, 80)} alt="" />
        ) : (
          <div className="flex size-full items-center justify-center bg-muted">
            <Icons.logo className="size-7 text-muted-foreground" />
          </div>
        )}
        {played > 0 && (
          <div
            role="progressbar"
            aria-label="Played"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(played * 100)}
            className="absolute inset-x-0 bottom-0 h-1 bg-black/40"
          >
            <div className="h-full bg-primary" style={{ width: `${played * 100}%` }} />
          </div>
        )}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-1 text-base font-semibold">
          {/* Stretched over the whole row, so clicking anywhere opens the episode;
              the buttons sit above it. */}
          <Link
            to="/podcasts/$slug/episodes/$episodeSlug/manage"
            params={{ slug: podcastSlug, episodeSlug: episode.slug }}
            className="outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          >
            {title}
          </Link>
        </ItemTitle>
        <ItemDescription className="text-xs">{meta.join(' · ')}</ItemDescription>
        {episode.description && episode.status === 'ready' && (
          <ItemDescription className="mt-1 line-clamp-2">{htmlToText(episode.description)}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions className="relative z-10">
        {episode.status === 'ready' && episode.audioUrl && (
          <Button size="icon-lg" className="rounded-full" onClick={play}>
            {isPlaying ? <Icons.pause /> : <Icons.play />}
            <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
          </Button>
        )}
        {(inProgress || episode.replacing) && (
          <Badge variant="secondary">
            <Spinner />
            {episode.replacing ? 'Replacing audio' : episode.progress ? stageLabels[episode.progress.stage] : 'Processing'}
          </Badge>
        )}
        {episode.status === 'failed' && (
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setReplacingAudio(true)}>
              <Icons.replaceAudio />
              Replace audio
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => retryMyEpisode({ data: { id: episode.id } }))}>
              <Icons.retry />
              Retry
            </Button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Icons.more />
              <span className="sr-only">Episode actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={inProgress} onSelect={() => setEditing(true)}>
              <Icons.edit />
              Edit episode
            </DropdownMenuItem>
            {(episode.status === 'ready' || episode.status === 'failed') && (
              <DropdownMenuItem disabled={episode.replacing} onSelect={() => setReplacingAudio(true)}>
                <Icons.replaceAudio />
                Replace audio
              </DropdownMenuItem>
            )}
            {episode.status === 'ready' && episode.audioUrl && (
              <DropdownMenuItem asChild>
                <a href={episode.audioUrl} download={`${episode.title}.mp3`}>
                  <Icons.download />
                  Download MP3
                </a>
              </DropdownMenuItem>
            )}
            {episode.sourceUrl && (
              <DropdownMenuItem asChild>
                <a href={episode.sourceUrl} target="_blank" rel="noreferrer">
                  <Icons.externalLink />
                  Open source
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={episode.status === 'processing' || episode.replacing}
              onSelect={() => setConfirmDelete(true)}
            >
              <Icons.delete />
              Delete episode
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
      {(inProgress || episode.replacing) && (
        <ItemFooter>
          <EpisodeProgress progress={episode.progress} />
        </ItemFooter>
      )}
      {/* Replacing the audio failed; the episode kept its old audio. */}
      {episode.status === 'ready' && episode.error && (
        <ItemFooter className="relative z-10">
          <p className="text-sm text-destructive">{episode.error}</p>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => run(() => dismissMyEpisodeError({ data: { id: episode.id } }))}
          >
            <Icons.close />
            <span className="sr-only">Dismiss</span>
          </Button>
        </ItemFooter>
      )}
      {episode.status === 'failed' && (
        <ItemFooter>
          <p className="text-sm text-destructive">{episode.error ?? 'Something went wrong downloading this episode.'}</p>
        </ItemFooter>
      )}
      <EditDetailsDialog
        open={editing}
        onOpenChange={setEditing}
        heading="Edit episode"
        description={`An episode of ${podcastTitle}.`}
        details={{ title: episode.title, description: episode.description, imageUrl: episode.imageUrl }}
        maxTitleLength={200}
        onSave={(change) => run(() => updateMyEpisode({ data: { id: episode.id, ...change } }))}
      />
      <ReplaceAudioDialog
        episodeId={episode.id}
        failed={episode.status === 'failed'}
        open={replacingAudio}
        onOpenChange={setReplacingAudio}
      />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this episode?</AlertDialogTitle>
            <AlertDialogDescription>
              “{title}” and its audio will be removed from {podcastTitle}. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                run(async () => {
                  if (isCurrent) player.close()
                  await deleteMyEpisode({ data: { id: episode.id } })
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Item>
  )
}
