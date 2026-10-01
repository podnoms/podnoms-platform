import { Icons } from '~/components/icons'
import { usePlayer } from '~/components/player/player-provider'
import { Button } from '~/components/ui/button'
import { Slider } from '~/components/ui/slider'
import { formatClock } from '~/lib/format'
import { imageSrc } from '~/lib/images'

const rates = [1, 1.25, 1.5, 1.75, 2]

// The now-playing bar pinned to the bottom of the app while an episode is loaded.
export function PlayerBar() {
  const player = usePlayer()
  const { episode } = player
  if (!episode) return null

  const nextRate = rates[(rates.indexOf(player.rate) + 1) % rates.length] ?? 1

  return (
    <div
      role="region"
      aria-label="Player"
      className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:gap-4"
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
