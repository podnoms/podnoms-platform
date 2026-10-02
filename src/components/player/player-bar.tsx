import { useEffect, useRef, type RefObject } from 'react'
import { Icons } from '~/components/icons'
import { usePlayer } from '~/components/player/player-provider'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Slider } from '~/components/ui/slider'
import { formatClock } from '~/lib/format'
import { imageSrc } from '~/lib/images'

const rates = [1, 1.25, 1.5, 1.75, 2]

// Keeps --player-height (see app.css) set to the bar's height while it's shown.
function usePlayerHeight(bar: RefObject<HTMLDivElement | null>, shown: boolean) {
  useEffect(() => {
    const element = bar.current
    if (!shown || !element) return
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--player-height', `${element.offsetHeight}px`))
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--player-height')
    }
  }, [bar, shown])
}

// The now-playing bar pinned across the bottom of the app while an episode is loaded.
export function PlayerBar() {
  const player = usePlayer()
  const { episode } = player
  const bar = useRef<HTMLDivElement>(null)
  usePlayerHeight(bar, Boolean(episode))
  if (!episode) return null

  const nextRate = rates[(rates.indexOf(player.rate) + 1) % rates.length] ?? 1

  return (
    <div
      ref={bar}
      role="region"
      aria-label="Player"
      className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 items-center gap-3 sm:w-64">
        {episode.imageUrl ? (
          <img src={imageSrc(episode.imageUrl, 40)} alt="" className="size-10 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icons.logo className="size-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{episode.title}</p>
          <p className="truncate text-xs text-muted-foreground">{episode.podcastTitle}</p>
        </div>
        <Button variant="ghost" size="icon-sm" className="ml-auto sm:hidden" onClick={player.close}>
          <Icons.close />
          <span className="sr-only">Close player</span>
        </Button>
      </div>
      <div className="flex flex-1 items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => player.skip(-15)} title="Back 15 seconds">
          <Icons.skipBack />
          <span className="sr-only">Back 15 seconds</span>
        </Button>
        <Button size="icon-lg" className="rounded-full" onClick={player.toggle}>
          {player.playing ? <Icons.pause /> : <Icons.play />}
          <span className="sr-only">{player.playing ? 'Pause' : 'Play'}</span>
        </Button>
        <Button variant="ghost" size="icon" onClick={() => player.skip(30)} title="Forward 30 seconds">
          <Icons.skipForward />
          <span className="sr-only">Forward 30 seconds</span>
        </Button>
        <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">
          {formatClock(player.currentTime)}
        </span>
        <Slider
          aria-label="Position"
          className="flex-1"
          min={0}
          max={player.duration || 1}
          step={1}
          value={[Math.min(player.currentTime, player.duration || 0)]}
          onValueChange={([seconds]) => seconds !== undefined && player.seek(seconds)}
        />
        <span className="w-14 text-xs text-muted-foreground tabular-nums">
          {player.duration ? formatClock(player.duration) : '--:--'}
        </span>
        <VolumeControl />
        <Button
          variant="ghost"
          size="sm"
          className="w-12 tabular-nums"
          onClick={() => player.setRate(nextRate)}
          title="Playback speed"
          aria-label={`Playback speed ${player.rate}×`}
        >
          {player.rate}×
        </Button>
        <Button variant="ghost" size="icon-sm" className="hidden sm:inline-flex" onClick={player.close}>
          <Icons.close />
          <span className="sr-only">Close player</span>
        </Button>
      </div>
    </div>
  )
}

// A speaker button that opens a vertical volume slider, with mute below it.
function VolumeControl() {
  const { volume, setVolume, toggleMute } = usePlayer()
  const silent = volume.muted || volume.level === 0
  const Icon = silent ? Icons.volumeMuted : volume.level < 0.5 ? Icons.volumeLow : Icons.volumeHigh
  const percent = silent ? 0 : Math.round(volume.level * 100)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title="Volume" aria-label={`Volume ${percent}%`}>
          <Icon />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" className="flex w-auto flex-col items-center gap-3 p-3">
        <span className="text-xs text-muted-foreground tabular-nums">{percent}%</span>
        <Slider
          aria-label="Volume"
          orientation="vertical"
          className="min-h-32"
          min={0}
          max={100}
          step={1}
          value={[percent]}
          onValueChange={([level]) => level !== undefined && setVolume(level / 100)}
        />
        <Button variant="ghost" size="icon-sm" onClick={toggleMute} title={silent ? 'Unmute' : 'Mute'}>
          {silent ? <Icons.volumeHigh /> : <Icons.volumeMuted />}
          <span className="sr-only">{silent ? 'Unmute' : 'Mute'}</span>
        </Button>
      </PopoverContent>
    </Popover>
  )
}
