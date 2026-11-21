import { useEffect, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { AuthorLink, Separated } from '~/components/author-link'
import { AddToPlaylistButton } from '~/components/add-to-playlist-button'
import { EditDetailsDialog } from '~/components/edit-details-dialog'
import { EpisodeComments, WaveformCommentBox } from '~/components/episode-comments'
import { Icons } from '~/components/icons'
import { LikeButton } from '~/components/like-button'
import { ReportImageButton } from '~/components/report-image-button'
import { usePlayer } from '~/components/player/player-provider'
import { Waveform } from '~/components/player/waveform'
import { EmbedButton, ShareButton } from '~/components/share-buttons'
import { TagList } from '~/components/tag-list'
import { Button } from '~/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '~/components/ui/popover'
import { Slider } from '~/components/ui/slider'
import type { fetchEpisodePage } from '~/functions/public'
import { setMyEpisodePrivacy, updateMyEpisode } from '~/functions/shows'
import { isCustomDomain } from '~/lib/current-domain'
import { formatClock, formatDate, initials, pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { mentionsAsText } from '~/lib/user-slug'
import { cn } from '~/lib/utils'
import { showParams, episodeParams } from '~/lib/paths'

export type EpisodePageData = Awaited<ReturnType<typeof fetchEpisodePage>>

// An episode as listeners see it: artwork, player and show notes. On the
// episode page it sits in the site's shell; `standalone`, it's the whole share
// page (see /s/$shortSlug): it names its show itself, and is just the player,
// without the show notes, comments, the owner's controls or the share and
// embed buttons. On a show's own domain, which has no accounts, it leaves out
// what needs one (likes, comments and the owner's controls) and the author.
export function PublicEpisode({ page, standalone = false }: { page: EpisodePageData; standalone?: boolean }) {
  const { show, episode, waveform, isOwner, shareUrl, embedUrl } = page
  const player = usePlayer()
  const router = useRouter()
  // The owner edits the episode's details here, rather than on its manage page.
  const [editing, setEditing] = useState(false)
  const onDomain = isCustomDomain()
  const commentable = !standalone && !onDomain
  // Shown with the details rather than on the button; the button keeps it current.
  const [likeCount, setLikeCount] = useState(episode.likeCount)
  const [comments, setComments] = useState(page.comments)
  // Another episode, or a reload, brings its own.
  useEffect(() => setComments(page.comments), [page.comments])
  // Where the listener clicked the waveform's comment band, while its box is open.
  const [commentAt, setCommentAt] = useState<number | null>(null)

  const isCurrent = player.episode?.id === episode.id
  const isPlaying = isCurrent && player.playing
  const position = isCurrent ? player.currentTime : player.positionOf(episode.id, episode.positionSeconds)
  const duration = (isCurrent && player.duration) || episode.durationSeconds || 0
  const artwork = episode.imageUrl ?? show.imageUrl
  // The share page leaves out the date and length; the waveform shows the length.
  const meta = [
    !onDomain ? <AuthorLink key="by" credit={show.credit} slug={show.ownerSlug} /> : null,
    standalone ? null : formatDate(episode.publishedAt ?? episode.createdAt),
    !standalone && episode.durationSeconds != null ? formatClock(episode.durationSeconds) : null,
    likeCount > 0 && !onDomain ? pluralise(likeCount, 'like') : null,
  ].filter(Boolean)

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
        ownerSlug: show.ownerSlug,
        isOwner,
        positionSeconds: episode.positionSeconds,
      },
      startAt === undefined ? undefined : { startAt },
    )
  }

  function seek(seconds: number) {
    if (isCurrent) player.seek(seconds)
    else play(seconds)
  }

  // Below the player: the show notes and comments, and more of the show's
  // episodes. On wide screens those sit in a column beside the notes and
  // comments, rather than pushing the comments down; on narrow ones they come
  // after the comments.
  const notes = episode.description && !standalone && (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">About this episode</h2>
      {/* Sanitised on the server (see rich-text.server.ts). */}
      <div className="rich-text max-w-prose" dangerouslySetInnerHTML={{ __html: episode.description }} />
    </section>
  )
  const discussion = commentable && (
    <EpisodeComments
      episodeId={episode.id}
      comments={comments}
      gifs={page.gifs}
      onChange={setComments}
      position={position}
      playing={isPlaying}
      onSeek={seek}
    />
  )
  const more = !standalone && page.moreEpisodes.length > 0 && (
    <MoreEpisodes show={show} episodes={page.moreEpisodes} beside={Boolean(notes || discussion)} />
  )

  return (
    <div className="flex flex-col gap-8">
      {!standalone && (
        <Link
          to="/$user/$show"
          params={showParams(show)}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icons.back className="size-4" />
          {show.title}
        </Link>
      )}

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
          {standalone && (
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">{show.title}</p>
          )}
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{episode.title}</h1>
          <p className="text-sm text-muted-foreground">
            <Separated items={meta} />
          </p>
          {/* One row: the episode's own tags, then the show's it doesn't already have. */}
          <TagList tags={[...episode.tags, ...show.tags.filter((tag) => !episode.tags.some((own) => own.id === tag.id))]} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="icon-lg" className="size-14 rounded-full [&_svg]:size-6!" onClick={() => play()}>
              {isPlaying ? <Icons.pause /> : <Icons.play />}
              <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
            </Button>
            <div className="flex flex-wrap gap-1 sm:ml-auto">
              <LikeButton
                variant="outline"
                episodeId={episode.id}
                liked={episode.liked}
                likeCount={episode.likeCount}
                count="hidden"
                onChange={(state) => setLikeCount(state.likeCount)}
              />
              {!standalone && <AddToPlaylistButton episodeId={episode.id} size="default" />}
              {isOwner && !standalone && !onDomain && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Icons.edit />
                  Edit
                </Button>
              )}
              {/* The share page is what's shared; it doesn't pass itself on. */}
              {!standalone && (
                <>
                  <ShareButton url={shareUrl} episodeId={episode.id} source="web" />
                  <EmbedButton embedUrl={embedUrl} title={episode.title} episodeId={episode.id} source="web" />
                </>
              )}
              <Button variant="ghost" size="icon" asChild title="Download MP3">
                <a href={episode.audioUrl!} download={`${episode.title}.mp3`}>
                  <Icons.download />
                  <span className="sr-only">Download MP3</span>
                </a>
              </Button>
              {artwork && !isOwner && (
                <ReportImageButton
                  targetKind={episode.imageUrl ? 'episode' : 'show'}
                  targetId={episode.imageUrl ? episode.id : show.id}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Player" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        {waveform ? (
          // Clicking the waveform's comment band opens a box there for a comment
          // at that point.
          <Popover open={commentAt !== null} onOpenChange={(open) => !open && setCommentAt(null)}>
            <div className="relative">
              <Waveform
                values={waveform}
                duration={duration}
                position={position}
                onSeek={seek}
                onComment={commentable ? setCommentAt : undefined}
                markers={
                  commentable
                    ? comments.map((comment) => ({
                        id: comment.id,
                        seconds: comment.atSeconds,
                        image: comment.author.image,
                        fallback: initials(comment.author.name, null),
                        title: `${comment.author.name ?? `@${comment.author.slug}`}: ${mentionsAsText(comment.body, comment.mentions) || 'GIF'}`,
                      }))
                    : []
                }
              />
              {commentAt !== null && duration > 0 && (
                <PopoverAnchor
                  className="pointer-events-none absolute top-full size-0"
                  style={{ left: `${(commentAt / duration) * 100}%` }}
                />
              )}
            </div>
            <PopoverContent side="bottom" className="w-80">
              {commentAt !== null && (
                <WaveformCommentBox
                  key={commentAt}
                  episodeId={episode.id}
                  atSeconds={commentAt}
                  gifs={page.gifs}
                  onChange={setComments}
                  onDone={() => setCommentAt(null)}
                />
              )}
            </PopoverContent>
          </Popover>
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

      {(notes || discussion || more) && (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
          {(notes || discussion) && (
            <div className="flex min-w-0 flex-col gap-8">
              {notes}
              {discussion}
            </div>
          )}
          {more}
        </div>
      )}

      {isOwner && !standalone && !onDomain && (
        <EditDetailsDialog
          open={editing}
          onOpenChange={setEditing}
          heading="Edit episode"
          description={`An episode of ${show.title}.`}
          imageContext={show.title}
          details={{
            title: episode.title,
            description: episode.description,
            imageUrl: episode.imageUrl,
            tags: episode.tags,
            private: episode.private,
            kind: 'episode',
          }}
          maxTitleLength={200}
          onSave={async ({ private: makePrivate, ...change }) => {
            await updateMyEpisode({ data: { id: episode.id, ...change } })
            if (makePrivate !== undefined) await setMyEpisodePrivacy({ data: { id: episode.id, private: makePrivate } })
            await router.invalidate()
          }}
        />
      )}
    </div>
  )
}

// How many of the show's other episodes a phone lists; the rest are a tap away
// on the show's page.
const moreOnNarrowScreens = 4

// The show's other episodes, compact enough for the episode page's side column.
function MoreEpisodes({
  show,
  episodes,
  beside,
}: {
  show: EpisodePageData['show']
  episodes: EpisodePageData['moreEpisodes']
  // In the side column, next to the notes and comments.
  beside: boolean
}) {
  return (
    <aside
      aria-labelledby="more-episodes-heading"
      className={cn('flex min-w-0 flex-col gap-3', beside ? 'xl:col-start-2 xl:row-start-1' : 'xl:col-span-full')}
    >
      <h2 id="more-episodes-heading" className="text-lg font-semibold text-balance">
        More from {show.title}
      </h2>
      <ul className="flex flex-col divide-y rounded-lg border">
        {episodes.map((other, i) => (
          <li key={other.id} className={i >= moreOnNarrowScreens ? 'max-xl:hidden' : undefined}>
            <Link
              to="/$user/$show/$episode"
              params={episodeParams(show, other.slug)}
              className="flex flex-col gap-0.5 px-4 py-3 text-sm hover:bg-muted/50"
            >
              <span className="line-clamp-2 font-medium">{other.title}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDate(other.publishedAt ?? other.createdAt)}
                {other.durationSeconds != null && ` · ${formatClock(other.durationSeconds)}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        to="/$user/$show"
        params={showParams(show)}
        className="flex w-fit items-center gap-1 text-sm text-primary hover:underline"
      >
        All episodes
        <Icons.chevronRight className="size-4" />
      </Link>
    </aside>
  )
}

// Head tags shared by the episode page and its standalone version: both
// describe the episode, but search engines are pointed at the episode page.
export function episodeHeadOptions(page: EpisodePageData) {
  return {
    title: page.episode.title,
    documentTitle: `${page.episode.title} – ${page.show.title}`,
    description: page.episode.description,
    fallbackDescription: `An episode of ${page.show.title}`,
    url: page.pageUrl,
    image: page.previewImage,
    type: 'music.song' as const,
    audioUrl: page.audioUrl,
    feedUrl: page.feedUrl,
    feedTitle: page.show.title,
    noindex: page.show.private,
  }
}
