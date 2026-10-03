import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Slider } from '~/components/ui/slider'
import { fetchEpisodePage } from '~/functions/public'
import { formatClock } from '~/lib/format'
import { imageSrc } from '~/lib/images'

// A compact player for an episode, made to be put in an <iframe> on other
// sites (see embedSnippet). It renders without the app's shell, and plays with
// its own <audio> element so it doesn't touch the app's player or what it
// remembers. Nothing stops it being framed; if a CSP or X-Frame-Options header
// is ever added, this route needs to be allowed.
export const Route = createFileRoute('/embed/$slug/$episodeSlug')({
  staticData: { bare: true },
  loader: ({ params }) => fetchEpisodePage({ data: { slug: params.slug, episodeSlug: params.episodeSlug } }),
  head: ({ loaderData: page }) => ({
    meta: [
      ...(page ? [{ title: `${page.episode.title} · podnoms` }] : []),
      // The episode's own page is the one to index.
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: EmbedPlayer,
})

function EmbedPlayer() {
  const { podcast, episode, pageUrl } = Route.useLoaderData()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(episode.durationSeconds ?? 0)
  const artwork = episode.imageUrl ?? podcast.imageUrl

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const update = () => {
      setPlaying(!audio.paused)
      setPosition(audio.currentTime)
      if (Number.isFinite(audio.duration)) setDuration(audio.duration)
    }
    const events = ['play', 'pause', 'timeupdate', 'durationchange', 'ended'] as const
    for (const event of events) audio.addEventListener(event, update)
    return () => {
      for (const event of events) audio.removeEventListener(event, update)
    }
  }, [])

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  function seek(seconds: number) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = seconds
    setPosition(seconds)
  }

  return (
    <div className="flex h-dvh items-center bg-card p-3 text-card-foreground">
      <audio ref={audioRef} src={episode.audioUrl!} preload="none" />
      <div className="flex w-full min-w-0 items-center gap-4">
        {artwork ? (
          <img src={imageSrc(artwork, 152)} alt="" className="size-28 shrink-0 rounded-lg object-cover sm:size-38" />
        ) : (
          <div className="flex size-28 shrink-0 items-center justify-center rounded-lg bg-muted sm:size-38">
            <Icons.logo className="size-10 text-muted-foreground" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <a
                href={pageUrl}
                target="_blank"
                rel="noreferrer"
                className="line-clamp-2 font-semibold leading-snug hover:underline"
              >
                {episode.title}
              </a>
              <p className="truncate text-sm text-muted-foreground">{podcast.title}</p>
            </div>
            <a
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <img src="/logo.png" alt="" className="size-4 rounded" />
              podnoms
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Button size="icon-lg" className="shrink-0 rounded-full" onClick={toggle}>
              {playing ? <Icons.pause /> : <Icons.play />}
              <span className="sr-only">{playing ? 'Pause' : 'Play'}</span>
            </Button>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Slider
                aria-label="Seek"
                min={0}
                max={duration || 1}
                step={1}
                value={[Math.min(position, duration)]}
                onValueChange={([seconds]) => seconds !== undefined && seek(seconds)}
              />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{formatClock(position)}</span>
                <span>{duration ? formatClock(duration) : '--:--'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
