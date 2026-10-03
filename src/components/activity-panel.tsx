import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '~/components/ui/chart'
import { Skeleton } from '~/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { fetchMyActivity } from '~/functions/activity'
import { activityPeriods } from '~/lib/activity-schema'
import type { ActivitySummary } from '~/server/activity.server'

type Period = (typeof activityPeriods)[number]

// Not the theme's chart colours, which are too pale to read on a light card:
// two hues checked for contrast and colour-blind separation in both themes.
const chartConfig = {
  play: { label: 'Plays', theme: { light: '#2a78d6', dark: '#3987e5' } },
  download: { label: 'Downloads', theme: { light: '#eb6834', dark: '#d95926' } },
} satisfies ChartConfig

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' })
const dayLabel = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const number = new Intl.NumberFormat('en')

// A podcast's plays, downloads and shares (or one episode's), for its owner.
// Fetched when shown rather than with the page, so the page's own reloads
// (while episodes process) don't redo it.
export function ActivityPanel({ slug, episodeSlug }: { slug: string; episodeSlug?: string }) {
  const [days, setDays] = useState<Period>(30)
  const [summary, setSummary] = useState<ActivitySummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    setFailed(false)
    fetchMyActivity({ data: { slug, episodeSlug, days } }).then(
      (result) => current && setSummary(result),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [slug, episodeSlug, days])

  const empty = summary && summary.totals.play + summary.totals.download + summary.totals.share === 0

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-5 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="activity-heading" className="text-lg font-semibold">
          Activity
        </h2>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(days)}
          onValueChange={(value) => value && setDays(Number(value) as Period)}
          aria-label="Period"
        >
          {activityPeriods.map((period) => (
            <ToggleGroupItem key={period} value={String(period)}>
              {period} days
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {failed ? (
        <p className="text-sm text-muted-foreground">Couldn't load the activity. Try again later.</p>
      ) : !summary ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Plays" value={summary.totals.play} />
            <Stat label="Downloads" value={summary.totals.download} />
            <Stat label="Shares" value={summary.totals.share} />
          </dl>
          {empty ? (
            <p className="text-sm text-muted-foreground">Nothing yet in the last {days} days.</p>
          ) : (
            <>
              <DailyChart daily={summary.daily} />
              <div className="grid gap-5 sm:grid-cols-3">
                <TopList
                  title="Countries"
                  rows={summary.countries.map((row) => ({ ...row, label: countryName(row.value) }))}
                  footnote="Locations from GeoLite2 data created by MaxMind."
                />
                <TopList title="Apps" rows={summary.clients.map((row) => ({ ...row, label: row.value }))} />
                <TopList title="Referring sites" rows={summary.referrers.map((row) => ({ ...row, label: row.value }))} />
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{number.format(value)}</dd>
    </div>
  )
}

// Plays and downloads per day, stacked. Shares are too few to chart.
function DailyChart({ daily }: { daily: ActivitySummary['daily'] }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="sr-only">Plays and downloads per day</figcaption>
      <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
        <BarChart data={daily} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(day: string) => dayLabel.format(new Date(day))}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
          <ChartTooltip
            cursor={{ fillOpacity: 0.5 }}
            content={<ChartTooltipContent labelFormatter={(day) => dayLabel.format(new Date(String(day)))} />}
          />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent className="justify-end pt-0 pb-3" />} />
          {/* The card-coloured stroke is the gap between the stacked segments. */}
          <Bar
            dataKey="download"
            stackId="activity"
            fill="var(--color-download)"
            stroke="var(--card)"
            strokeWidth={2}
            maxBarSize={24}
          />
          <Bar
            dataKey="play"
            stackId="activity"
            fill="var(--color-play)"
            stroke="var(--card)"
            strokeWidth={2}
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          />
        </BarChart>
      </ChartContainer>
      {/* The chart's numbers, for screen readers. */}
      <table className="sr-only">
        <caption>Plays and downloads per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Plays</th>
            <th scope="col">Downloads</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((entry) => (
            <tr key={entry.day}>
              <th scope="row">{dayLabel.format(new Date(entry.day))}</th>
              <td>{entry.play}</td>
              <td>{entry.download}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

function TopList({
  title,
  rows,
  footnote,
}: {
  title: string
  rows: { label: string; count: number }[]
  footnote?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not known yet.</p>
      ) : (
        <ol className="flex flex-col gap-1.5 text-sm">
          {rows.map((row) => (
            <li key={row.label} className="flex justify-between gap-3">
              <span className="truncate">{row.label}</span>
              <span className="text-muted-foreground tabular-nums">{number.format(row.count)}</span>
            </li>
          ))}
        </ol>
      )}
      {footnote && rows.length > 0 && <p className="text-xs text-muted-foreground">{footnote}</p>}
    </div>
  )
}

function countryName(code: string) {
  try {
    return countryNames.of(code) ?? code
  } catch {
    return code
  }
}
