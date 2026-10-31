import { useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { EditDetailsDialog } from '~/components/edit-details-dialog'
import { EpisodeProgress } from '~/components/episode-progress'
import { Icons } from '~/components/icons'
import { usePlayer } from '~/components/player/player-provider'
import { Waveform } from '~/components/player/waveform'
import { ReplaceAudioDialog } from '~/components/replace-audio-dialog'
import { ShareButton } from '~/components/share-buttons'
import { TagList } from '~/components/tag-list'
import { TrackedLinksCard } from '~/components/tracked-links-card'
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
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Slider } from '~/components/ui/slider'
import {
  deleteMyEpisode,
  dismissMyEpisodeError,
  fetchMyEpisode,
  fetchMyEpisodeSlug,
  retryMyEpisode,
  setMyEpisodePrivacy,
  updateMyEpisode,
} from '~/functions/shows'
import { useLiveProgress, withLiveProgress } from '~/hooks/use-episode-events'
import { formatClock, formatDate, hostname, initials, pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { pageTitle } from '~/lib/branding'

// An episode's management page, at /:slug/:episodeSlug/manage. The trailing
// underscore on $slug_ keeps it from nesting inside the show page's route.
export const Route = createFileRoute('/_authed/$slug_/$episodeSlug/manage')({
  loader: ({ params }) => fetchMyEpisode({ data: { slug: params.slug, episodeSlug: params.episodeSlug } }),
  head: ({ loaderData, matches }) => ({ meta: loaderData ? [{ title: pageTitle(matches, loaderData.episode.title) }] : [] }),
  component: EpisodePage,
})

function EpisodePage() {
  const loaded = Route.useLoaderData()
  const { show, episode, waveform } = loaded
  const router = useRouter()
  const player = usePlayer()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [replacingAudio, setReplacingAudio] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [savingPrivacy, setSavingPrivacy] = useState(false)

  const inProgress = episode.status === 'pending' || episode.status === 'processing'
  // While the episode is being processed or its audio replaced, follow it live
  // rather than polling. When its details change, reload them; a link's
  // temporary slug is replaced when its title is fetched, so follow it to the
  // new URL rather than reloading the old one.
  const live = useLiveProgress(show.slug, inProgress || episode.replacing, loaded, async (changed) => {
    if (changed.size > 0 && !changed.has(episode.id)) return
    const slug = await fetchMyEpisodeSlug({ data: { id: episode.id } }).catch(() => null)
    if (slug && slug !== episode.slug) {
      await navigate({
        to: '/$slug/$episodeSlug/manage',
        params: { slug: show.slug, episodeSlug: slug },
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
  const artwork = episode.imageUrl ?? show.imageUrl

  // The source's title isn't known until it's fetched; show where it's from meanwhile.
  const title = episode.title === episode.sourceUrl ? `Episode from ${hostname(episode.title)}` : episode.title
  const meta = [
    formatDate(episode.publishedAt ?? episode.createdAt),
    episode.durationSeconds != null ? formatClock(episode.durationSeconds) : null,
    episode.sourceUrl ? hostname(episode.sourceUrl) : null,
    episode.likeCount > 0 ? pluralise(episode.likeCount, 'like') : null,
  ].filter(Boolean)
  // Who sees the public page, so it's clear this one is only the owner's.
  const whoCanSee = !ready
    ? 'Listeners see it once it’s ready.'
    : episode.private
      ? 'Private: only you can see it.'
      : show.private
        ? 'Only you can see its page; listeners hear it through the show’s private feed.'
        : 'Listeners see it on its public page.'

  function play(startAt?: number) {
    if (!episode.audioUrl) return
    player.play(
      {
        id: episode.id,
        title: episode.title,
        audioUrl: episode.audioUrl,
        imageUrl: artwork,
        showTitle: show.title,
        slug: episode.slug,
        showSlug: show.slug,
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
      await navigate({ to: '/$slug/manage', params: { slug: show.slug } })
    } finally {
      setDeleting(false)
    }
  }

  async function togglePrivacy() {
    setSavingPrivacy(true)
    try {
      await setMyEpisodePrivacy({ data: { id: episode.id, private: !episode.private } })
      await router.invalidate({ filter: (match) => match.routeId === Route.id })
    } finally {
      setSavingPrivacy(false)
    }
  }

  function seek(seconds: number) {
    if (isCurrent) player.seek(seconds)
    else play(seconds)
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-8 p-4 md:p-6">
      <Link
        to="/$slug/manage"
        params={{ slug: show.slug }}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <Icons.back className="size-4" />
        {show.title}
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
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Managing this episode</p>
            {episode.private && (
              <Badge variant="secondary">
                <Icons.private />
                Private
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
          <p className="text-sm text-muted-foreground">{meta.join(' · ')}</p>
          <p className="text-sm text-muted-foreground">{whoCanSee}</p>
          <TagList tags={episode.tags} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {ready && (
              <Button size="icon-lg" className="size-14 rounded-full [&_svg]:size-6!" onClick={() => play()}>
                {isPlaying ? <Icons.pause /> : <Icons.play />}
                <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
              </Button>
            )}
            {ready && (
              <Button variant="outline" asChild>
                <Link to="/$slug/$episodeSlug" params={{ slug: show.slug, episodeSlug: episode.slug }}>
                  <Icons.externalLink />
                  View public page
                </Link>
              </Button>
            )}
            <div className="flex gap-1 sm:ml-auto">
              {/* A private episode's or show's share link only works for its owner. */}
              {ready && !episode.private && !show.private && (
                <ShareButton url={loaded.shortUrl} episodeId={loaded.episode.id} source="web" />
              )}
              <Button variant="outline" disabled={inProgress} onClick={() => setEditing(true)}>
                <Icons.edit />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={savingPrivacy}
                onClick={togglePrivacy}
                title={episode.private ? 'Make public' : 'Make private'}
              >
                {episode.private ? <Icons.public /> : <Icons.private />}
                <span className="sr-only">{episode.private ? 'Make public' : 'Make private'}</span>
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
            <Waveform
              values={waveform}
              duration={duration}
              position={position}
              onSeek={seek}
              markers={loaded.comments.map((comment) => ({
                id: comment.id,
                seconds: comment.atSeconds,
                image: comment.author.image,
                fallback: initials(comment.author.name, null),
                title: `${comment.author.name ?? `@${comment.author.slug}`}: ${comment.text}`,
              }))}
            />
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
          {/* Comments are read, written and answered on the public page. */}
          <Link
            to="/$slug/$episodeSlug"
            params={{ slug: show.slug, episodeSlug: episode.slug }}
            hash="comments-heading"
            className="flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Icons.comment className="size-4" />
            {loaded.commentCount ? `${pluralise(loaded.commentCount, 'comment')} on the public page` : 'Comment on the public page'}
          </Link>
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

      {/* Like the Share button, only while the share page works for others. */}
      {ready && !episode.private && !show.private && (
        <TrackedLinksCard
          episodeId={episode.id}
          links={loaded.trackedLinks}
          onChange={() => router.invalidate({ filter: (match) => match.routeId === Route.id })}
        />
      )}

      {ready && <ActivityPanel slug={show.slug} episodeSlug={episode.slug} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this episode?</AlertDialogTitle>
            <AlertDialogDescription>
              “{title}” and its audio will be removed from {show.title}. This can't be undone.
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
        description={`An episode of ${show.title}.`}
        imageContext={show.title}
        details={{ title: episode.title, description: episode.description, imageUrl: episode.imageUrl, tags: episode.tags }}
        maxTitleLength={200}
        onSave={async (change) => {
          await updateMyEpisode({ data: { id: episode.id, ...change } })
          await router.invalidate()
        }}
      />
    </div>
  )
}
