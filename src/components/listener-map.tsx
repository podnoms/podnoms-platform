import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { geoEqualEarth, geoPath } from 'd3-geo'
import { alpha2ToNumeric } from 'i18n-iso-countries'
import { feature } from 'topojson-client'
import { countryName } from '~/components/activity-panel'
import { Skeleton } from '~/components/ui/skeleton'
import { binIndex, mapBins } from '~/lib/map-bins'

export type CountryCount = { country: string; plays: number; downloads: number }

type Shape = { id: string; name: string; d: string }

const width = 960
const height = 470
const number = new Intl.NumberFormat('en')

// One blue ramp, light to dark (dark to light in the dark theme, so more
// listeners always stands out further from the card). The same blue as Plays
// in the activity chart.
const ramp = [
  'fill-[#b7d3f6] dark:fill-[#184f95]',
  'fill-[#86b6ef] dark:fill-[#256abf]',
  'fill-[#3987e5] dark:fill-[#3987e5]',
  'fill-[#256abf] dark:fill-[#6da7ec]',
  'fill-[#104281] dark:fill-[#b7d3f6]',
]
const swatch = [
  'bg-[#b7d3f6] dark:bg-[#184f95]',
  'bg-[#86b6ef] dark:bg-[#256abf]',
  'bg-[#3987e5] dark:bg-[#3987e5]',
  'bg-[#256abf] dark:bg-[#6da7ec]',
  'bg-[#104281] dark:bg-[#b7d3f6]',
]

// With fewer bins than steps, spread them across the ramp.
function rampStep(bin: number, bins: number) {
  return bins === 1 ? 2 : Math.round((bin * (ramp.length - 1)) / (bins - 1))
}

// The country shapes, projected once. The map data (about 100 KB) is only
// loaded by pages that show the map.
let shapes: Promise<Shape[]> | undefined
function loadShapes() {
  shapes ??= import('world-atlas/countries-110m.json').then(({ default: topology }) => {
    const countries = feature(topology, topology.objects.countries)
    // Antarctica takes up a lot of room and has no listeners.
    countries.features = countries.features.filter((country) => country.id !== '010')
    const projection = geoEqualEarth().fitSize([width, height], countries)
    const path = geoPath(projection)
    return countries.features.map((country) => ({
      id: String(country.id ?? country.properties.name),
      name: country.properties.name,
      d: path(country) ?? '',
    }))
  })
  return shapes
}

// Where plays and downloads came from, as a world map coloured by count.
export function ListenerMap({ countries }: { countries: CountryCount[] }) {
  const [loaded, setLoaded] = useState<Shape[] | null>(null)
  const [failed, setFailed] = useState(false)
  // The country under the pointer, and where to show its tooltip
  // as a fraction of the map's size.
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  useEffect(() => {
    let current = true
    loadShapes().then(
      (result) => current && setLoaded(result),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [])

  const { byId, bins } = useMemo(() => {
    const byId = new Map<string, CountryCount & { total: number }>()
    let max = 0
    for (const row of countries) {
      const id = alpha2ToNumeric(row.country)
      const total = row.plays + row.downloads
      if (id) byId.set(id, { ...row, total })
      max = Math.max(max, total)
    }
    return { byId, bins: mapBins(max) }
  }, [countries])

  if (failed) return <p className="text-sm text-muted-foreground">Couldn't load the map.</p>
  if (!loaded) return <Skeleton className="aspect-[96/47] w-full" />

  const hovered = hover && loaded.find((shape) => shape.id === hover.id)
  const hoveredCounts = hover && byId.get(hover.id)

  function pointAt(event: PointerEvent) {
    const box = svg.current!.getBoundingClientRect()
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
  }

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">Plays and downloads by country</figcaption>
      <div className="relative">
        <svg
          ref={svg}
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          aria-hidden="true"
          onPointerLeave={() => setHover(null)}
        >
          {loaded.map((shape) => {
            const counts = byId.get(shape.id)
            const bin = counts ? binIndex(bins, counts.total) : -1
            return (
              <path
                key={shape.id}
                d={shape.d}
                className={`stroke-card stroke-[0.5] transition-opacity ${bin < 0 ? 'fill-muted' : ramp[rampStep(bin, bins.length)]} ${hover && hover.id !== shape.id ? 'opacity-70' : ''}`}
                onPointerMove={(event) => setHover({ id: shape.id, ...pointAt(event) })}
              />
            )
          })}
          {/* The hovered country's outline, drawn on top so neighbours don't cover it. */}
          {hovered && <path d={hovered.d} className="pointer-events-none fill-none stroke-foreground stroke-[1.5]" />}
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
            // Kept clear of the edges so the tooltip isn't cut off.
            style={{ left: `${Math.min(0.85, Math.max(0.15, hover.x)) * 100}%`, top: `calc(${hover.y * 100}% - 12px)` }}
          >
            <p className="font-medium">{hoveredCounts ? countryName(hoveredCounts.country) : hovered.name}</p>
            <p className="text-muted-foreground tabular-nums">
              {hoveredCounts
                ? `${number.format(hoveredCounts.plays)} plays · ${number.format(hoveredCounts.downloads)} downloads`
                : 'No plays or downloads'}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-muted" />
          None
        </span>
        {bins.map((bin, i) => (
          <span key={bin.from} className="flex items-center gap-1.5 tabular-nums">
            <span className={`size-3 rounded-sm ${swatch[rampStep(i, bins.length)]}`} />
            {bin.from === bin.to ? number.format(bin.from) : `${number.format(bin.from)}–${number.format(bin.to)}`}
          </span>
        ))}
        <span className="ml-auto">Plays and downloads · GeoLite2 data created by MaxMind</span>
      </div>

      {/* The map's numbers, for screen readers. */}
      <table className="sr-only">
        <caption>Plays and downloads by country</caption>
        <thead>
          <tr>
            <th scope="col">Country</th>
            <th scope="col">Plays</th>
            <th scope="col">Downloads</th>
          </tr>
        </thead>
        <tbody>
          {countries.map((row) => (
            <tr key={row.country}>
              <th scope="row">{countryName(row.country)}</th>
              <td>{row.plays}</td>
              <td>{row.downloads}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
