import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from 'cn'
import { formatClock } from '~/lib/format'

const barWidth = 3
const barGap = 1
// The bars, and their reflection below at a fraction of the height.
const barsHeight = 88
const reflectionHeight = 28
const height = barsHeight + 1 + reflectionHeight

// Combines the stored bars (see waveforms.server.ts) into as many as fit.
function resample(values: number[], count: number) {
  if (count <= 0 || values.length === 0) return []
  if (values.length <= count) return values
  return Array.from({ length: count }, (_, bar) => {
    const start = Math.floor((bar * values.length) / count)
    const end = Math.max(start + 1, Math.floor(((bar + 1) * values.length) / count))
    let sum = 0
    for (let i = start; i < end; i++) sum += values[i]!
    return sum / (end - start)
  })
}

// A Mixcloud-style waveform that shows how far through the episode the
// listener is. Click or drag to seek; arrow keys seek by 5 seconds, Page
// Up/Down by 30.
export function Waveform({
  values,
  duration,
  position,
  onSeek,
  className,
}: {
  // Bar heights from 0 to 255.
  values: number[]
  duration: number
  position: number
  onSeek: (seconds: number) => void
  className?: string
}) {
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
