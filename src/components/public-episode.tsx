import { Link } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { usePlayer } from '~/components/player/player-provider'
import { Waveform } from '~/components/player/waveform'
import { EmbedButton, ShareButton } from '~/components/share-buttons'
import { Button } from '~/components/ui/button'
import { Slider } from '~/components/ui/slider'
import type { fetchEpisodePage } from '~/functions/public'
import { formatClock, formatDate } from '~/lib/format'
import { imageSrc } from '~/lib/images'

export type EpisodePageData = Awaited<ReturnType<typeof fetchEpisodePage>>

// An episode as listeners see it: artwork, player and show notes. On the
// episode page it sits in the site's shell; `standalone`, it's the whole page
// (see /listen), so it names its podcast itself and leaves out the owner's
// controls.
export function PublicEpisode({ page, standalone = false }: { page: EpisodePageData; standalone?: boolean }) {
  const { podcast, episode, waveform, isOwner, shortUrl, embedUrl } = page
  const player = usePlayer()

  const isCurrent = player.episode?.id === episode.id
  const isPlaying = isCurrent && player.playing
  const position = isCurrent ? player.currentTime : player.positionOf(episode.id, episode.positionSeconds)
  const duration = (isCurrent && player.duration) || episode.durationSeconds || 0
  const artwork = episode.imageUrl ?? podcast.imageUrl
  const meta = [
    podcast.author ? `by ${podcast.author}` : null,
    formatDate(episode.publishedAt ?? episode.createdAt),
    episode.durationSeconds != null ? formatClock(episode.durationSeconds) : null,
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
    <div className="flex flex-col gap-8">
      {!standalone && (
        <Link
          to="/podcasts/$slug"
          params={{ slug: podcast.slug }}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icons.back className="size-4" />
          {podcast.title}
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
          <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {standalone ? (
              <Link to="/podcasts/$slug" params={{ slug: podcast.slug }} className="hover:text-foreground">
                {podcast.title}
              </Link>
            ) : (
              'Episode'
            )}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{episode.title}</h1>
          <p className="text-sm text-muted-foreground">{meta.join(' · ')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
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
            <div className="flex flex-wrap gap-1 sm:ml-auto">
              {isOwner && !standalone && (
                <Button variant="outline" asChild>
                  <Link
                    to="/podcasts/$slug/episodes/$episodeSlug/manage"
                    params={{ slug: podcast.slug, episodeSlug: episode.slug }}
                  >
                    <Icons.settings />
                    Manage
                  </Link>
                </Button>
              )}
              <ShareButton url={shortUrl} episodeId={episode.id} source={standalone ? 'listen' : 'web'} />
              <EmbedButton
                embedUrl={embedUrl}
                title={episode.title}
                episodeId={episode.id}
                source={standalone ? 'listen' : 'web'}
              />
              <Button variant="ghost" size="icon" asChild title="Download MP3">
                <a href={episode.audioUrl!} download={`${episode.title}.mp3`}>
                  <Icons.download />
                  <span className="sr-only">Download MP3</span>
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

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

      {episode.description && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">About this episode</h2>
          {/* Sanitised on the server (see rich-text.server.ts). */}
          <div className="rich-text max-w-prose" dangerouslySetInnerHTML={{ __html: episode.description }} />
        </section>
      )}
    </div>
  )
}

// Head tags shared by the episode page and its standalone version: both
// describe the episode, but search engines are pointed at the episode page.
export function episodeHeadOptions(page: EpisodePageData) {
  return {
    title: page.episode.title,
    description: page.episode.description,
    fallbackDescription: `An episode of ${page.podcast.title}`,
    url: page.pageUrl,
    image: page.previewImage,
    type: 'music.song' as const,
    audioUrl: page.audioUrl,
    feedUrl: page.feedUrl,
    feedTitle: page.podcast.title,
    noindex: page.podcast.private,
  }
}
