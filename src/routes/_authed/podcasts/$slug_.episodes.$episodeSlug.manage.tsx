import { useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { EditDetailsDialog } from '~/components/edit-details-dialog'
import { EpisodeProgress } from '~/components/episode-progress'
import { Icons } from '~/components/icons'
import { usePlayer } from '~/components/player/player-provider'
import { Waveform } from '~/components/player/waveform'
import { ReplaceAudioDialog } from '~/components/replace-audio-dialog'
import { ShareButton } from '~/components/share-buttons'
import { ActivityPanel } from '~/components/activity-panel'
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
import { Button } from '~/components/ui/button'
import { Slider } from '~/components/ui/slider'
import {
  deleteMyEpisode,
  dismissMyEpisodeError,
  fetchMyEpisode,
  fetchMyEpisodeSlug,
  retryMyEpisode,
  updateMyEpisode,
} from '~/functions/podcasts'
import { useLiveProgress, withLiveProgress } from '~/hooks/use-episode-events'
import { formatClock, formatDate, hostname } from '~/lib/format'
import { imageSrc } from '~/lib/images'

// An episode's management page, at /podcasts/:slug/episodes/:episodeSlug/manage. The trailing
// underscore on $slug_ keeps it from nesting inside the podcast page's route.
export const Route = createFileRoute('/_authed/podcasts/$slug_/episodes/$episodeSlug/manage')({
  loader: ({ params }) => fetchMyEpisode({ data: { slug: params.slug, episodeSlug: params.episodeSlug } }),
  head: ({ loaderData }) => ({ meta: loaderData ? [{ title: `${loaderData.episode.title} · podnoms` }] : [] }),
  component: EpisodePage,
})

function EpisodePage() {
  const loaded = Route.useLoaderData()
  const { podcast, episode, waveform } = loaded
  const router = useRouter()
  const player = usePlayer()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [replacingAudio, setReplacingAudio] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const inProgress = episode.status === 'pending' || episode.status === 'processing'
  // While the episode is being processed or its audio replaced, follow it live
  // rather than polling. When its details change, reload them; a link's
  // temporary slug is replaced when its title is fetched, so follow it to the
  // new URL rather than reloading the old one.
  const live = useLiveProgress(podcast.slug, inProgress || episode.replacing, loaded, async (changed) => {
    if (changed.size > 0 && !changed.has(episode.id)) return
    const slug = await fetchMyEpisodeSlug({ data: { id: episode.id } }).catch(() => null)
    if (slug && slug !== episode.slug) {
      await navigate({
        to: '/podcasts/$slug/episodes/$episodeSlug/manage',
        params: { slug: podcast.slug, episodeSlug: slug },
        replace: true,
      })
    } else {
      await router.invalidate({ filter: (match) => match.routeId === Route.id })
    }
  })
  const progress = withLiveProgress(episode, live).progress

  const ready = episode.status === 'ready' && episode.audioUrl !== null
  const isCurrent = player.episode?.id === episode.id
  const isPlaying = isCurrent && player.playing
  const position = isCurrent ? player.currentTime : player.positionOf(episode.id, episode.positionSeconds)
  const duration = (isCurrent && player.duration) || episode.durationSeconds || 0
  const artwork = episode.imageUrl ?? podcast.imageUrl

  // The source's title isn't known until it's fetched; show where it's from meanwhile.
  const title = episode.title === episode.sourceUrl ? `Episode from ${hostname(episode.title)}` : episode.title
  const meta = [
    formatDate(episode.publishedAt ?? episode.createdAt),
    episode.durationSeconds != null ? formatClock(episode.durationSeconds) : null,
    episode.sourceUrl ? hostname(episode.sourceUrl) : null,
  ].filter(Boolean)

  function play(startAt?: number) {
    if (!episode.audioUrl) return
    player.play(
      {
        id: episode.id,
        title: episode.title,
        audioUrl: episode.audioUrl,
        imageUrl: artwork,
        podcastTitle: podcast.title,
        slug: episode.slug,
        podcastSlug: podcast.slug,
        isOwner: true,
        positionSeconds: episode.positionSeconds,
      },
      startAt === undefined ? undefined : { startAt },
    )
  }

  async function deleteEpisode() {
    setDeleting(true)
    try {
      if (isCurrent) player.close()
      await deleteMyEpisode({ data: { id: episode.id } })
      await navigate({ to: '/podcasts/$slug/manage', params: { slug: podcast.slug } })
    } finally {
      setDeleting(false)
    }
  }

  function seek(seconds: number) {
    if (isCurrent) player.seek(seconds)
    else play(seconds)
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-8 p-4 md:p-6">
      <Link
        to="/podcasts/$slug/manage"
        params={{ slug: podcast.slug }}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <Icons.back className="size-4" />
        {podcast.title}
      </Link>

      <section className="flex flex-col gap-6 sm:flex-row sm:items-end">
        {artwork ? (
          <img
            src={imageSrc(artwork, 224)}
            alt=""
            className="size-40 shrink-0 rounded-xl object-cover shadow-md sm:size-56"
          />
        ) : (
          <div className="flex size-40 shrink-0 items-center justify-center rounded-xl bg-muted sm:size-56">
            <Icons.logo className="size-12 text-muted-foreground" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Episode</p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
          <p className="text-sm text-muted-foreground">{meta.join(' · ')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {ready && (
              <>
                <Button size="icon-lg" className="size-14 rounded-full [&_svg]:size-6!" onClick={() => play()}>
                  {isPlaying ? <Icons.pause /> : <Icons.play />}
                  <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!isCurrent}
                  onClick={() => player.skip(-15)}
                  title="Back 15 seconds"
                >
                  <Icons.skipBack />
                  <span className="sr-only">Back 15 seconds</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={!isCurrent}
                  onClick={() => player.skip(30)}
                  title="Forward 30 seconds"
                >
                  <Icons.skipForward />
                  <span className="sr-only">Forward 30 seconds</span>
                </Button>
              </>
            )}
            <div className="flex gap-1 sm:ml-auto">
              {ready && <ShareButton url={loaded.shareUrl} episodeId={loaded.episode.id} source="web" />}
              <Button variant="outline" disabled={inProgress} onClick={() => setEditing(true)}>
                <Icons.edit />
                Edit
              </Button>
              {(episode.status === 'ready' || episode.status === 'failed') && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={episode.replacing}
                  onClick={() => setReplacingAudio(true)}
                  title="Replace audio"
                >
                  <Icons.replaceAudio />
                  <span className="sr-only">Replace audio</span>
                </Button>
              )}
              {ready && (
                <Button variant="ghost" size="icon" asChild title="Download MP3">
                  <a href={episode.audioUrl!} download={`${episode.title}.mp3`}>
                    <Icons.download />
                    <span className="sr-only">Download MP3</span>
                  </a>
                </Button>
              )}
              {episode.sourceUrl && (
                <Button variant="ghost" size="icon" asChild title="Open source">
                  <a href={episode.sourceUrl} target="_blank" rel="noreferrer">
                    <Icons.externalLink />
                    <span className="sr-only">Open source</span>
                  </a>
                </Button>
              )}
              {/* Episodes can't be deleted mid-download or while their audio is replaced. */}
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={episode.status === 'processing' || episode.replacing}
                onClick={() => setConfirmDelete(true)}
                title="Delete episode"
              >
                <Icons.delete />
                <span className="sr-only">Delete episode</span>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {ready && (
        <section aria-label="Player" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          {waveform ? (
            <Waveform values={waveform} duration={duration} position={position} onSeek={seek} />
          ) : (
            // Waveforms are made just after processing; until then, a plain seek bar.
            <Slider
              aria-label="Seek"
              className="py-4"
              min={0}
              max={duration || 1}
              step={1}
              value={[Math.min(position, duration)]}
              onValueChange={([seconds]) => seconds !== undefined && seek(seconds)}
            />
          )}
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{formatClock(position)}</span>
            <span>{duration ? formatClock(duration) : '--:--'}</span>
          </div>
        </section>
      )}
      {inProgress && (
        <section className="rounded-xl border bg-card p-4">
          <EpisodeProgress progress={progress} />
        </section>
      )}
      {episode.replacing && (
        <section className="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">Replacing the audio</p>
          <EpisodeProgress progress={progress} />
        </section>
      )}
      {/* Replacing the audio failed; the episode kept its old audio. */}
      {episode.status === 'ready' && episode.error && (
        <section className="flex items-center gap-4 rounded-xl border border-destructive/40 bg-card p-4">
          <p className="text-sm text-destructive">{episode.error}</p>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={async () => {
              await dismissMyEpisodeError({ data: { id: episode.id } })
              await router.invalidate()
            }}
          >
            <Icons.close />
            <span className="sr-only">Dismiss</span>
          </Button>
        </section>
      )}
      {episode.status === 'failed' && (
        <section className="flex items-center gap-4 rounded-xl border border-destructive/40 bg-card p-4">
          <p className="text-sm text-destructive">
            {episode.error ?? 'Something went wrong downloading this episode.'}
          </p>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => setReplacingAudio(true)}>
              <Icons.replaceAudio />
              Replace audio
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await retryMyEpisode({ data: { id: episode.id } })
                await router.invalidate()
              }}
            >
              <Icons.retry />
              Retry
            </Button>
          </div>
        </section>
      )}

      {episode.description && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">About this episode</h2>
          {/* Sanitised on the server (see rich-text.server.ts). */}
          <div className="rich-text max-w-prose" dangerouslySetInnerHTML={{ __html: episode.description }} />
        </section>
      )}

      {ready && <ActivityPanel slug={podcast.slug} episodeSlug={episode.slug} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this episode?</AlertDialogTitle>
            <AlertDialogDescription>
              “{title}” and its audio will be removed from {podcast.title}. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={deleteEpisode}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ReplaceAudioDialog
        episodeId={episode.id}
        failed={episode.status === 'failed'}
        open={replacingAudio}
        onOpenChange={setReplacingAudio}
      />
      <EditDetailsDialog
        open={editing}
        onOpenChange={setEditing}
        heading="Edit episode"
        description={`An episode of ${podcast.title}.`}
        imageContext={podcast.title}
        details={{ title: episode.title, description: episode.description, imageUrl: episode.imageUrl }}
        maxTitleLength={200}
        onSave={async (change) => {
          await updateMyEpisode({ data: { id: episode.id, ...change } })
          await router.invalidate()
        }}
      />
    </div>
  )
}
