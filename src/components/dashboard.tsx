import { useEffect, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { DailyChart, TopList, countryName } from '~/components/activity-panel'
import { Icons, type Icon } from '~/components/icons'
import { ListenerMap } from '~/components/listener-map'
import { NewPodcastDialog } from '~/components/new-podcast-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { fetchDashboard } from '~/functions/dashboard'
import { activityPeriods } from '~/lib/activity-schema'
import { formatDate, formatLength } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import type { Dashboard as DashboardData } from '~/server/dashboard.server'

type Period = (typeof activityPeriods)[number]

const number = new Intl.NumberFormat('en')
const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 })

// The signed-in home page: counts and listener stats across all the user's
// podcasts. Starts with the period the route loaded; other periods are
// fetched when picked.
export function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial)
  const [days, setDays] = useState<Period>(initial.days as Period)
  const [failed, setFailed] = useState(false)

  // A reload of the route (after creating a podcast, say) starts over.
  useEffect(() => {
    setData(initial)
    setDays(initial.days as Period)
  }, [initial])

  useEffect(() => {
    if (days === data.days) return
    let current = true
    setFailed(false)
    fetchDashboard({ data: { days } }).then(
      (result) => current && setData(result),
      () => current && setFailed(true),
    )
    return () => {
      current = false
    }
  }, [days, data.days])

  const { activity, previousTotals, episodes } = data
  const loading = days !== data.days && !failed
  const quiet = activity.totals.play + activity.totals.download + activity.totals.share === 0

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">How your podcasts are doing over the last {days} days.</p>
        </div>
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
        <NewPodcastDialog>
          <Button>
            <Icons.add />
            New podcast
          </Button>
        </NewPodcastDialog>
      </header>

      {failed && <p className="text-sm text-destructive">Couldn't load the stats for that period. Try again later.</p>}

      <dl
        aria-busy={loading}
        className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 xl:grid-cols-5 ${loading ? 'opacity-60' : ''}`}
      >
        <StatTile icon={Icons.logo} label="Podcasts" value={data.podcasts} />
        <StatTile
          icon={Icons.audioFile}
          label="Episodes"
          value={episodes.total}
          note={<EpisodeNote {...episodes} />}
        />
        <StatTile
          icon={Icons.play}
          label="Plays"
          value={activity.totals.play}
          note={<Change current={activity.totals.play} previous={previousTotals.play} />}
        />
        <StatTile
          icon={Icons.download}
          label="Downloads"
          value={activity.totals.download}
          note={<Change current={activity.totals.download} previous={previousTotals.download} />}
        />
        <StatTile
          icon={Icons.share}
          label="Shares"
          value={activity.totals.share}
          note={<Change current={activity.totals.share} previous={previousTotals.share} />}
        />
      </dl>

      <Panel title="Plays and downloads" className={loading ? 'opacity-60' : ''}>
        {quiet ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No plays or downloads in the last {days} days. Share an episode or add your feed to a podcast app to get
            started.
          </p>
        ) : (
          <DailyChart daily={activity.daily} />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Top episodes">
          {data.topEpisodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing played or downloaded in the last {days} days.</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {data.topEpisodes.map((episode, i) => (
                <li key={episode.id}>
                  <EpisodeLink episode={episode}>
                    <span className="w-4 shrink-0 text-center text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                    <Artwork url={episode.imageUrl} />
                    <EpisodeTitle title={episode.title} detail={episode.podcastTitle} />
                    <span className="ml-auto flex shrink-0 gap-3 text-xs text-muted-foreground tabular-nums">
                      <span className="flex items-center gap-1" title="Plays">
                        <Icons.play className="size-3" />
                        <span className="sr-only">Plays:</span>
                        {number.format(episode.plays)}
                      </span>
                      <span className="flex items-center gap-1" title="Downloads">
                        <Icons.download className="size-3" />
                        <span className="sr-only">Downloads:</span>
                        {number.format(episode.downloads)}
                      </span>
                    </span>
                  </EpisodeLink>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Recently added">
          {data.recentEpisodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No episodes yet. Open a podcast and add a link to make one.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {data.recentEpisodes.map((episode) => (
                <li key={episode.id}>
                  <EpisodeLink episode={episode}>
                    <Artwork url={episode.imageUrl} />
                    <EpisodeTitle
                      title={episode.title}
                      detail={[
                        episode.podcastTitle,
                        formatDate(new Date(episode.createdAt)),
                        episode.durationSeconds ? formatLength(episode.durationSeconds) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                    <StatusBadge status={episode.status} />
                  </EpisodeLink>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {!quiet && (
        <Panel title="Listeners">
          <div className="grid gap-5 sm:grid-cols-3">
            <TopList
              title="Countries"
              rows={activity.countries.map((row) => ({ ...row, label: countryName(row.value) }))}
              footnote="Locations from GeoLite2 data created by MaxMind."
            />
            <TopList title="Apps" rows={activity.clients.map((row) => ({ ...row, label: row.value }))} />
            <TopList title="Referring sites" rows={activity.referrers.map((row) => ({ ...row, label: row.value }))} />
          </div>
        </Panel>
      )}

      {!quiet && (
        <Panel title="Where your listeners are" className={loading ? 'opacity-60' : ''}>
          {data.countries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No locations known for the last {days} days.</p>
          ) : (
            <ListenerMap countries={data.countries} />
          )}
        </Panel>
      )}
    </div>
  )
}

function Panel({ title, className = '', children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={`flex flex-col gap-4 rounded-xl border bg-card p-4 transition-opacity sm:p-5 ${className}`}>
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function StatTile({ icon: TileIcon, label, value, note }: { icon: Icon; label: string; value: number; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        <TileIcon className="size-4 text-primary" />
        {label}
      </dt>
      <dd className="text-3xl font-semibold tabular-nums">{number.format(value)}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  )
}

function EpisodeNote({ inProgress, failed, totalSeconds }: DashboardData['episodes']) {
  const parts = []
  if (inProgress) parts.push(`${inProgress} processing`)
  if (failed) parts.push(`${failed} failed`)
  if (parts.length === 0) return totalSeconds ? <>{formatLength(totalSeconds)} of audio</> : <>None yet</>
  return <span className={failed ? 'text-destructive' : undefined}>{parts.join(' · ')}</span>
}

// The change on the previous period of the same length.
function Change({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return <>{current ? 'Up from none' : 'None in the previous period'}</>
  const change = (current - previous) / previous
  if (Math.abs(change) < 0.005) return <>Same as the previous period</>
  const ChangeIcon = change > 0 ? Icons.trendUp : Icons.trendDown
  return (
    <span className="flex items-center gap-1">
      <ChangeIcon className="size-3.5" />
      {change > 0 ? '+' : ''}
      {percent.format(change)} on the previous period
    </span>
  )
}

type EpisodeSummary = { title: string; slug: string; podcastSlug: string }

function EpisodeLink({ episode, children }: { episode: EpisodeSummary; children: ReactNode }) {
  return (
    <Link
      to="/podcasts/$slug/episodes/$episodeSlug/manage"
      params={{ slug: episode.podcastSlug, episodeSlug: episode.slug }}
      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60"
    >
      {children}
    </Link>
  )
}

function Artwork({ url }: { url: string | null }) {
  return url ? (
    <img src={imageSrc(url, 40)} alt="" className="size-10 shrink-0 rounded-md object-cover" />
  ) : (
    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted">
      <Icons.logo className="size-4 text-muted-foreground" />
    </span>
  )
}

function EpisodeTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-medium">{title}</span>
      <span className="truncate text-xs text-muted-foreground">{detail}</span>
    </span>
  )
}

function StatusBadge({ status }: { status: DashboardData['recentEpisodes'][number]['status'] }) {
  if (status === 'ready') return null
  return (
    <Badge variant={status === 'failed' ? 'destructive' : 'secondary'} className="ml-auto shrink-0">
      {status === 'failed' ? 'Failed' : 'Processing'}
    </Badge>
  )
}
