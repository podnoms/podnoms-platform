import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from 'cn'
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
// size on an episode's page, compact in lists.
const sizes = {
  default: { barsHeight: 88, reflectionHeight: 28 },
  compact: { barsHeight: 40, reflectionHeight: 14 },
}

// A Mixcloud-style waveform that shows how far through the episode the
// listener is. Click or drag to seek; arrow keys seek by 5 seconds, Page
// Up/Down by 30. Markers (such as where comments were made) show as tiny
// avatars along the bottom, with their title on hover.
export function Waveform({
  values,
  duration,
  position,
  onSeek,
  markers = [],
  size = 'default',
  className,
}: {
  // Bar heights from 0 to 255.
  values: number[]
  duration: number
  position: number
  onSeek: (seconds: number) => void
  markers?: WaveformMarker[]
  size?: keyof typeof sizes
  className?: string
}) {
  const { barsHeight, reflectionHeight } = sizes[size]
  const height = barsHeight + 1 + reflectionHeight
  const id = useId()
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // Where the pointer is, as a fraction of the width, while hovering or dragging.
  const [hover, setHover] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

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
  const lower = paths(reflectionHeight, barsHeight + 1, -1)

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
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        setHover(fractionAt(event))
      }}
      onPointerMove={(event) => setHover(fractionAt(event))}
      onPointerUp={(event) => {
        if (!dragging) return
        setDragging(false)
        onSeek(fractionAt(event) * duration)
      }}
      onPointerCancel={() => setDragging(false)}
      onPointerLeave={() => {
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
          {hover !== null && !dragging && (
            <g className="fill-primary/40" clipPath={`url(#${id}-hover)`}>
              <path d={upper} />
              <path d={lower} opacity={0.5} />
            </g>
          )}
          <g className="fill-primary" clipPath={`url(#${id}-played)`}>
            <path d={upper} />
            <path d={lower} opacity={0.4} />
          </g>
        </svg>
      )}
      {duration > 0 &&
        markers.map((marker) => (
          // Pressing one seeks like anywhere else on the waveform.
          <Avatar
            key={marker.id}
            aria-hidden="true"
            title={`${formatClock(marker.seconds)} · ${marker.title}`}
            className="absolute bottom-0 size-5 -translate-x-1/2 ring-2 ring-card hover:z-10"
            style={{ left: `${Math.min(100, (marker.seconds / duration) * 100)}%` }}
          >
            {marker.image && <AvatarImage src={imageSrc(marker.image, 32)} alt="" />}
            <AvatarFallback className="bg-primary text-[8px] text-primary-foreground">{marker.fallback}</AvatarFallback>
          </Avatar>
        ))}
      {hover !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-xs text-background tabular-nums"
          style={{ left: `${Math.min(Math.max(hover * 100, 4), 96)}%` }}
        >
          {formatClock(hover * duration)}
        </div>
      )}
    </div>
  )
}
