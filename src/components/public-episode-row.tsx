import { Link } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { usePlayer } from '~/components/player/player-provider'
import { Button } from '~/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '~/components/ui/item'
import { formatClock, formatDate } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { htmlToText } from '~/lib/rich-text'

export type PublicEpisodeRowData = {
  id: string
  title: string
  slug: string
  description: string | null
  imageUrl: string | null
  audioUrl: string | null
  durationSeconds: number | null
  createdAt: Date
  publishedAt: Date | null
  positionSeconds: number | null
}

// A row of a public podcast page's episode list: the listener's view of
// EpisodeRow, without anything for managing the episode.
export function PublicEpisodeRow({
  episode,
  podcastSlug,
  podcastTitle,
  podcastImageUrl,
}: {
  episode: PublicEpisodeRowData
  podcastSlug: string
  podcastTitle: string
  podcastImageUrl: string | null
}) {
  const player = usePlayer()
  const isCurrent = player.episode?.id === episode.id
  const isPlaying = isCurrent && player.playing
  const artwork = episode.imageUrl ?? podcastImageUrl

  const position = isCurrent ? player.currentTime : player.positionOf(episode.id, episode.positionSeconds)
  const length = (isCurrent && player.duration) || episode.durationSeconds || 0
  const played = length > 0 && position > 0 ? Math.min(position / length, 1) : 0

  function play() {
    if (!episode.audioUrl) return
    player.play({
      id: episode.id,
      title: episode.title,
      audioUrl: episode.audioUrl,
      imageUrl: artwork,
      podcastTitle,
      positionSeconds: episode.positionSeconds,
    })
  }

  const meta = [
    formatDate(episode.publishedAt ?? episode.createdAt),
    episode.durationSeconds != null ? formatClock(episode.durationSeconds) : null,
  ].filter(Boolean)

  return (
    <Item
      role="listitem"
      data-current={isCurrent || undefined}
      className="relative gap-4 rounded-none px-4 py-3 transition-colors before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary before:opacity-0 hover:bg-muted/50 data-current:bg-primary/5 data-current:before:opacity-100"
    >
      <ItemMedia variant="image" className="relative size-16 rounded-md">
        {artwork ? (
          <img src={imageSrc(artwork, 64)} alt="" />
        ) : (
          <div className="flex size-full items-center justify-center bg-muted">
            <Icons.logo className="size-6 text-muted-foreground" />
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
        <ItemTitle className="line-clamp-1">
          {/* Stretched over the whole row, so clicking anywhere opens the episode;
              the play button sits above it. */}
          <Link
            to="/podcasts/$slug/episodes/$episodeSlug"
            params={{ slug: podcastSlug, episodeSlug: episode.slug }}
            className="outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          >
            {episode.title}
          </Link>
        </ItemTitle>
        <ItemDescription>{meta.join(' · ')}</ItemDescription>
        {episode.description && (
          <ItemDescription className="line-clamp-2">{htmlToText(episode.description)}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions className="relative z-10">
        {episode.audioUrl && (
          <Button size="icon-lg" className="rounded-full" onClick={play}>
            {isPlaying ? <Icons.pause /> : <Icons.play />}
            <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
          </Button>
        )}
      </ItemActions>
    </Item>
  )
}
