import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { fetchAdminUser } from '~/functions/admin'
import { pageTitle } from '~/lib/branding'
import { formatBytes, formatCount, formatDateTime, formatLength, formatRelative } from '~/lib/format'
import { episodeParams, showParams } from '~/lib/paths'
import type { AdminUserDetail, DiskUseKind } from '~/server/admin-users.server'

// An admin's page about one user, opened from the Users tab at /admin. Meant
// to grow: add more about the user as another card.
export const Route = createFileRoute('/_authed/admin/users/$userId')({
  beforeLoad: ({ context }) => {
    if (!context.session?.user?.isAdmin) throw notFound()
  },
  loader: ({ params }) => fetchAdminUser({ data: { userId: params.userId } }),
  head: ({ matches, loaderData }) => ({
    meta: [{ title: pageTitle(matches, loaderData ? `${loaderData.user.name ?? loaderData.user.email} · Admin` : 'Admin') }],
  }),
  component: AdminUserPage,
})

const diskUseLabels: Record<DiskUseKind, string> = {
  audio: 'MP3s',
  masters: 'Masters',
  hls: 'HLS streams',
  waveforms: 'Waveforms',
  sources: 'Uploads waiting to be processed',
  uploads: 'Staged uploads and images',
  images: 'Artwork',
}

function AdminUserPage() {
  const detail = Route.useLoaderData()
  const { user } = detail

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/admin" search={{ tab: 'users' }} aria-label="Back to users">
            <Icons.back />
          </Link>
        </Button>
        <div className="flex flex-col">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {user.name ?? user.email}
            {user.isAdmin && <Badge variant="secondary">Admin</Badge>}
            {user.disabledAt && <Badge variant="destructive">Disabled</Badge>}
            {user.onHoldAt && <Badge variant="secondary">On hold</Badge>}
            {user.excludedAt && <Badge variant="outline">Excluded</Badge>}
          </h1>
          <span className="text-sm text-muted-foreground">
            {user.name && <>{user.email} · </>}
            <Link to="/$user" params={{ user: user.slug }} className="hover:underline">
              @{user.slug}
            </Link>
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Shows" value={formatCount(detail.shows.length)} />
        <Stat label="Episodes" value={formatCount(detail.episodes)} />
        <Stat label="Audio" value={detail.seconds ? formatLength(detail.seconds) : '—'} />
        <Stat label="Disk space" value={detail.disk.total ? formatBytes(detail.disk.total) : '—'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <HistoryCard history={detail.history} />
          <ShowsCard shows={detail.shows} />
        </div>
        <div className="flex flex-col gap-6">
          <DiskUseCard disk={detail.disk} />
          <ListeningCard listening={detail.listening} playlists={detail.playlists} />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

const listeningLabels: Record<keyof AdminUserDetail['listening'], string> = {
  started: 'Episodes started',
  played: 'Episodes played',
  likes: 'Episodes liked',
  follows: 'Shows followed',
  ignored: 'Shows ignored',
  comments: 'Comments',
  likedComments: 'Comments liked',
  chat: 'Live chat messages',
  devices: 'App devices signed in',
}

// What they do as a listener. Plays, downloads and shares are counted for
// show owners without saying who (see activity.server.ts), so they can't be
// shown per user.
const historyKinds = [
  { type: 'play', label: 'Plays', verb: 'Played' },
  { type: 'download', label: 'Downloads', verb: 'Downloaded' },
  { type: 'share', label: 'Shares', verb: 'Shared' },
] as const

const historySources = { web: 'on the site', listen: 'from a share page', embed: 'in an embed', app: 'in an app' } as const

// What they've played, downloaded and shared while signed in (see
// listening-history.server.ts), unless they've turned it off.
function HistoryCard({ history }: { history: AdminUserDetail['history'] }) {
  const verbs = Object.fromEntries(historyKinds.map((kind) => [kind.type, kind.verb]))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Listening history
          {!history.keep && <Badge variant="outline">Turned off</Badge>}
        </CardTitle>
        <CardDescription>
          {history.keep
            ? 'What they play, download and share while signed in, once a day per episode, kept for a year.'
            : "They've turned their listening history off in their settings, so nothing is kept."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-4">
          {historyKinds.map(({ type, label }) => (
            <div key={type} className="flex flex-col">
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="text-xl font-semibold tabular-nums">{formatCount(history[type].count)}</span>
              <span className="text-xs text-muted-foreground">{formatCount(history[type].lastMonth)} in the last 30 days</span>
            </div>
          ))}
        </div>
        {history.recent.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Episode</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="text-end">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.recent.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <Link
                        to="/$user/$show/$episode"
                        params={episodeParams(event, event.episodeSlug)}
                        className="font-medium hover:underline"
                      >
                        {event.episodeTitle}
                      </Link>
                      <span className="text-xs text-muted-foreground">{event.showTitle}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {verbs[event.type]} {event.type === 'share' && event.detail === 'embed' ? '(embed) ' : ''}
                    {/* Downloads are always the audio file itself, from wherever. */}
                    {event.type !== 'download' && historySources[event.source]}
                  </TableCell>
                  <TableCell className="text-end text-sm whitespace-nowrap" title={formatDateTime(event.occurredAt)}>
                    {formatRelative(event.occurredAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function ListeningCard({ listening, playlists }: { listening: AdminUserDetail['listening']; playlists: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Listening</CardTitle>
        <CardDescription>
          Started is episodes with a saved position. The time is when they last did each.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2 text-sm">
          {(Object.keys(listeningLabels) as (keyof typeof listeningLabels)[]).map((key) => (
            <div key={key} className="flex items-baseline justify-between gap-4">
              <dt>{listeningLabels[key]}</dt>
              <dd className="flex items-baseline gap-2 tabular-nums">
                {listening[key].lastAt && (
                  <span className="text-xs text-muted-foreground">{formatRelative(listening[key].lastAt)}</span>
                )}
                {formatCount(listening[key].count)}
              </dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-4">
            <dt>Playlists</dt>
            <dd className="tabular-nums">{formatCount(playlists)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

function DiskUseCard({ disk }: { disk: AdminUserDetail['disk'] }) {
  const kinds = (Object.keys(diskUseLabels) as DiskUseKind[]).filter((kind) => disk[kind] > 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Disk space</CardTitle>
        <CardDescription>Measured from their files now, so it takes a moment for big accounts.</CardDescription>
      </CardHeader>
      <CardContent>
        {kinds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files.</p>
        ) : (
          <dl className="flex flex-col gap-3 text-sm">
            {kinds.map((kind) => (
              <div key={kind} className="flex flex-col gap-1">
                <div className="flex justify-between gap-4">
                  <dt>{diskUseLabels[kind]}</dt>
                  <dd className="tabular-nums">{formatBytes(disk[kind])}</dd>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(disk[kind] / disk.total) * 100}%` }} />
                </div>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t pt-3 font-medium">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatBytes(disk.total)}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function ShowsCard({ shows }: { shows: AdminUserDetail['shows'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Shows</CardTitle>
        <CardDescription>Biggest on disk first.</CardDescription>
      </CardHeader>
      <CardContent>
        {shows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shows.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Show</TableHead>
                <TableHead className="text-end">Episodes</TableHead>
                <TableHead className="text-end">Audio</TableHead>
                <TableHead className="text-end">Disk space</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shows.map((show) => (
                <TableRow key={show.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2">
                        <Link to="/$user/$show" params={showParams(show)} className="font-medium hover:underline">
                          {show.title}
                        </Link>
                        {show.private && <Badge variant="outline">Private</Badge>}
                      </span>
                      <EpisodeStatuses statuses={show.statuses} />
                    </div>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{formatCount(show.episodes)}</TableCell>
                  <TableCell className="text-end tabular-nums">{show.seconds ? formatLength(show.seconds) : '—'}</TableCell>
                  <TableCell className="text-end tabular-nums">{show.disk.total ? formatBytes(show.disk.total) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// Episodes that aren't ready yet, e.g. "2 processing · 1 failed"; nothing
// when they all are.
function EpisodeStatuses({ statuses }: { statuses: AdminUserDetail['shows'][number]['statuses'] }) {
  const parts = [
    statuses.pending && `${formatCount(statuses.pending)} pending`,
    statuses.processing && `${formatCount(statuses.processing)} processing`,
    statuses.failed && `${formatCount(statuses.failed)} failed`,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return <span className="text-xs text-muted-foreground">{parts.join(' · ')}</span>
}
