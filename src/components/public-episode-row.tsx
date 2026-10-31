import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { AddToPlaylistButton } from '~/components/add-to-playlist-button'
import { LikeButton } from '~/components/like-button'
import { usePlayer } from '~/components/player/player-provider'
import { Waveform } from '~/components/player/waveform'
import { ShareButton } from '~/components/share-buttons'
import { TagList } from '~/components/tag-list'
import { Button } from '~/components/ui/button'
import { formatClock, formatDate, formatRelative } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { shortPath } from '~/lib/paths'
import type { Tag } from '~/lib/tag-schema'
import { cn } from '~/lib/utils'

export type PublicEpisodeRowData = {
  id: string
  title: string
  slug: string
  shortSlug: string
  imageUrl: string | null
  audioUrl: string | null
  durationSeconds: number | null
  createdAt: Date
  publishedAt: Date | null
  positionSeconds: number | null
  likeCount: number
  liked: boolean
  tags?: Tag[]
  // Bar heights for the row's waveform; null until it's been made.
  waveform: number[] | null
}

// An episode in a listener's list, laid out as Mixcloud does: the artwork, a
// play button by the title, the episode's waveform to see how far through it
// you are and to seek, and buttons to like and share it. In lists across
// shows (Likes, Explore), `withShow` names the show too. In a
// playlist, `onPlay` starts it playing through the playlist instead, and
// `actions` are the owner's buttons for it.
export function PublicEpisodeRow({
  episode,
  showSlug,
  showTitle,
  showImageUrl,
  isOwner,
  withShow = false,
  onPlay,
  actions,
}: {
  episode: PublicEpisodeRowData
  showSlug: string
  showTitle: string
  showImageUrl: string | null
  isOwner: boolean
  withShow?: boolean
  onPlay?: () => void
  actions?: ReactNode
}) {
  const player = usePlayer()
  const isCurrent = player.episode?.id === episode.id
  const isPlaying = isCurrent && player.playing
  const artwork = episode.imageUrl ?? showImageUrl
  const position = isCurrent ? player.currentTime : player.positionOf(episode.id, episode.positionSeconds)
  const duration = (isCurrent && player.duration) || episode.durationSeconds || 0
  const published = episode.publishedAt ?? episode.createdAt
  const episodeLink = { to: '/$slug/$episodeSlug', params: { slug: showSlug, episodeSlug: episode.slug } } as const

  function play(startAt?: number) {
    if (!episode.audioUrl) return
    if (onPlay && !isCurrent) return onPlay()
    player.play(
      {
        id: episode.id,
        title: episode.title,
        audioUrl: episode.audioUrl,
        imageUrl: artwork,
        showTitle,
        slug: episode.slug,
        showSlug,
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

  return (
    <li
      data-current={isCurrent || undefined}
      className="group/row flex gap-4 py-5 first:pt-0 last:pb-0 sm:gap-6"
    >
      <Link {...episodeLink} className="shrink-0 self-start outline-none" tabIndex={-1} aria-hidden>
        {artwork ? (
          <img
            src={imageSrc(artwork, 160)}
            alt=""
            className="size-20 rounded-lg object-cover shadow-sm ring-1 ring-black/5 sm:size-36"
          />
        ) : (
          <div className="flex size-20 items-center justify-center rounded-lg bg-muted sm:size-36">
            <Icons.logo className="size-8 text-muted-foreground" />
          </div>
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-3">
          {episode.audioUrl && (
            <Button
              size="icon-lg"
              className="size-11 shrink-0 rounded-full shadow-sm sm:size-12 [&_svg]:size-5!"
              onClick={() => play()}
            >
              {isPlaying ? <Icons.pause /> : <Icons.play className="translate-x-px fill-current" />}
              <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
            </Button>
          )}
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-sm text-muted-foreground">
              {withShow && (
                <Separated>
                  <Link to="/$slug" params={{ slug: showSlug }} className="hover:text-foreground hover:underline">
                    {showTitle}
                  </Link>
                </Separated>
              )}
              <time dateTime={published.toISOString()} title={formatDate(published)} suppressHydrationWarning>
                {formatRelative(published)}
              </time>
            </p>
            <h3 className="truncate text-base font-semibold sm:text-lg">
              <Link {...episodeLink} className={cn('hover:underline', isCurrent && 'text-primary')}>
                {episode.title}
              </Link>
            </h3>
          </div>
        </div>
        <TagList tags={episode.tags} />
        <div className="flex items-center gap-3">
          {episode.waveform ? (
            <Waveform
              size="compact"
              values={episode.waveform}
              duration={duration}
              position={position}
              onSeek={seek}
              className="min-w-0 flex-1"
            />
          ) : (
            // Waveforms are made just after processing; until then, a plain bar.
            <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${duration ? Math.min(1, position / duration) * 100 : 0}%` }} />
            </div>
          )}
          {duration > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatClock(duration)}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LikeButton variant="outline" episodeId={episode.id} liked={episode.liked} likeCount={episode.likeCount} />
          <ShareButton url={shortPath(episode.shortSlug)} episodeId={episode.id} source="web" size="sm" />
          <AddToPlaylistButton episodeId={episode.id} />
          {actions}
        </div>
      </div>
    </li>
  )
}

// The list the rows go in, with a rule between them.
export function PublicEpisodeList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y">{children}</ul>
}

function Separated({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <span aria-hidden className="mx-1.5">
        •
      </span>
    </>
  )
}
