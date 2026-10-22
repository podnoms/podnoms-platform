import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from 'cn'
import { Icons } from '~/components/icons'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { formatClock } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { resample } from '~/lib/waveform'

// A point to mark on the waveform, shown as a tiny avatar: its image, or the
// fallback text (such as initials) without one.
export type WaveformMarker = { id: string; seconds: number; image: string | null; fallback: string; title: string }

const barWidth = 3
const barGap = 1
// The bars, and their reflection below at a fraction of the height: full
// size on an episode's page, compact in lists. Mini, in the player bar, has
// no reflection: at that size it reads as a split down the middle.
export const waveformSizes = {
  default: { barsHeight: 88, reflectionHeight: 28 },
  compact: { barsHeight: 40, reflectionHeight: 14 },
  mini: { barsHeight: 32, reflectionHeight: 0 },
}

const tones = {
  primary: { played: 'fill-primary', hover: 'fill-primary/40' },
  neutral: { played: 'fill-foreground', hover: 'fill-foreground/40' },
}

// A Mixcloud-style waveform that shows how far through the episode the
// listener is. Click or drag to seek; arrow keys seek by 5 seconds, Page
// Up/Down by 30. Markers (such as where comments were made) show as tiny
// avatars along the bottom, with their title on hover. With `onComment`, the
// bottom band (the reflection) is for commenting, as on SoundCloud: hovering
// it shows a + at the pointer, and clicking it calls onComment with that
// time, though pressing a marker still seeks to it.
export function Waveform({
  values,
  duration,
  position,
  onSeek,
  markers = [],
  onComment,
  size = 'default',
  tone = 'primary',
  className,
}: {
  // Bar heights from 0 to 255.
  values: number[]
  duration: number
  position: number
  onSeek: (seconds: number) => void
  markers?: WaveformMarker[]
  onComment?: (seconds: number) => void
  size?: keyof typeof waveformSizes
  // The played part's colour: the theme's primary, or its foreground where
  // primary would be too loud (the player bar).
  tone?: keyof typeof tones
  className?: string
}) {
  const { barsHeight, reflectionHeight } = waveformSizes[size]
  const height = reflectionHeight ? barsHeight + 1 + reflectionHeight : barsHeight
  const id = useId()
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // Where the pointer is, as a fraction of the width, while hovering or dragging.
  const [hover, setHover] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  // Whether the pointer is in the comment band (and not on a marker), and
  // whether it was pressed there.
  const [commenting, setCommenting] = useState(false)
  const [commentPressed, setCommentPressed] = useState(false)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const bars = useMemo(
    () => resample(values, Math.floor((width + barGap) / (barWidth + barGap))),
    [values, width],
  )

  const played = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0
  // While dragging, show where playback will jump to.
  const shown = dragging && hover !== null ? hover : played

  function fractionAt(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  }

  // The time of the marker under the pointer, if any.
  function markerAt(event: PointerEvent<HTMLDivElement>) {
    const element = (event.target as Element).closest<HTMLElement>('[data-marker-seconds]')
    return element ? Number(element.dataset.markerSeconds) : null
  }

  function inCommentBand(event: PointerEvent<HTMLDivElement>) {
    if (!onComment || !reflectionHeight || !duration) return false
    return event.clientY - event.currentTarget.getBoundingClientRect().top > barsHeight
  }

  function track(event: PointerEvent<HTMLDivElement>) {
    setHover(fractionAt(event))
    setCommenting(!dragging && inCommentBand(event) && markerAt(event) === null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5, PageDown: -30, PageUp: 30 }[event.key]
    let target: number | null = step !== undefined ? position + step : null
    if (event.key === 'Home') target = 0
    if (event.key === 'End') target = duration
    if (target === null || !duration) return
    event.preventDefault()
    onSeek(Math.min(duration, Math.max(0, target)))
  }

  const paths = (scale: number, top: number, direction: 1 | -1) =>
    bars
      .map((value, i) => {
        const h = Math.max(1, (value / 255) * scale)
        const x = i * (barWidth + barGap)
        return direction === 1 ? `M${x} ${top - h}h${barWidth}v${h}h${-barWidth}z` : `M${x} ${top}h${barWidth}v${h}h${-barWidth}z`
      })
      .join('')
  const upper = paths(barsHeight, barsHeight, 1)
  const lower = reflectionHeight ? paths(reflectionHeight, barsHeight + 1, -1) : ''

  return (
    <div
      ref={container}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={`${formatClock(position)} of ${formatClock(duration)}`}
      className={cn(
        'relative cursor-pointer touch-none rounded-md outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      style={{ height }}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (inCommentBand(event)) {
          setCommentPressed(true)
          return
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        setHover(fractionAt(event))
      }}
      onPointerMove={track}
      onPointerUp={(event) => {
        if (commentPressed) {
          setCommentPressed(false)
          if (!inCommentBand(event)) return
          const marker = markerAt(event)
          if (marker !== null) onSeek(marker)
          else onComment?.(fractionAt(event) * duration)
          return
        }
        if (!dragging) return
        setDragging(false)
        onSeek(fractionAt(event) * duration)
      }}
      onPointerCancel={() => {
        setDragging(false)
        setCommentPressed(false)
      }}
      onPointerLeave={() => {
        setCommentPressed(false)
        setCommenting(false)
        if (!dragging) setHover(null)
      }}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true" className="block">
          <defs>
            <clipPath id={`${id}-played`}>
              <rect width={shown * width} height={height} />
            </clipPath>
            <clipPath id={`${id}-hover`}>
              <rect width={(hover ?? 0) * width} height={height} />
            </clipPath>
          </defs>
          <g className="fill-muted-foreground/30">
            <path d={upper} />
            <path d={lower} opacity={0.5} />
          </g>
          {hover !== null && !dragging && !commenting && (
            <g className={tones[tone].hover} clipPath={`url(#${id}-hover)`}>
              <path d={upper} />
              <path d={lower} opacity={0.5} />
            </g>
          )}
          <g className={tones[tone].played} clipPath={`url(#${id}-played)`}>
            <path d={upper} />
            <path d={lower} opacity={0.4} />
          </g>
        </svg>
      )}
      {duration > 0 &&
        markers.map((marker) => (
          // Pressing one seeks to it.
          <Avatar
            key={marker.id}
            aria-hidden="true"
            data-marker-seconds={marker.seconds}
            title={`${formatClock(marker.seconds)} · ${marker.title}`}
            className="absolute bottom-0 size-5 -translate-x-1/2 ring-2 ring-card hover:z-10"
            style={{ left: `${Math.min(100, (marker.seconds / duration) * 100)}%` }}
          >
            {marker.image && <AvatarImage src={imageSrc(marker.image, 32)} alt="" />}
            <AvatarFallback className="bg-primary text-[8px] text-primary-foreground">{marker.fallback}</AvatarFallback>
          </Avatar>
        ))}
      {commenting && hover !== null && (
        <div
          className="pointer-events-none absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-foreground text-background shadow-sm"
          style={{ left: `${hover * 100}%`, top: barsHeight }}
        >
          <Icons.add className="size-3.5" strokeWidth={3} />
        </div>
      )}
      {hover !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-xs whitespace-nowrap text-background tabular-nums"
          style={{ left: `${Math.min(Math.max(hover * 100, commenting ? 8 : 4), commenting ? 92 : 96)}%` }}
        >
          {commenting ? `Comment at ${formatClock(hover * duration)}` : formatClock(hover * duration)}
        </div>
      )}
    </div>
  )
}
