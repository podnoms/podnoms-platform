import { useDeferredValue, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupInput } from '~/components/ui/input-group'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatCount, formatDate, formatLength, formatRelative, pluralise } from '~/lib/format'
import { showParams } from '~/lib/paths'
import { platformNames, type Platform } from '~/lib/platforms'
import type { AdminShow, AdminShowSource } from '~/server/admin-shows.server'

const sorts = {
  recent: { label: 'Recently added to', by: (show: AdminShow) => show.lastAddedAt?.getTime() ?? 0 },
  episodes: { label: 'Most episodes', by: (show: AdminShow) => show.episodes },
  audio: { label: 'Most audio', by: (show: AdminShow) => show.seconds },
  created: { label: 'Newest shows', by: (show: AdminShow) => show.createdAt.getTime() },
}
type Sort = keyof typeof sorts

// Whether a show matches what's typed in the search box: any word in its
// title, address or its owner's name or email.
function matchesSearch(show: AdminShow, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const text = [show.title, show.slug, show.ownerSlug, show.owner.name, show.owner.email].filter(Boolean).join(' ').toLowerCase()
  return words.every((word) => text.includes(word))
}

// What the episodes from one source are, e.g. "116 uploaded files".
function sourceLabel(source: AdminShowSource, show: AdminShow) {
  switch (source.origin) {
    case 'upload':
      return pluralise(source.episodes, 'uploaded file')
    case 'link':
      return `${pluralise(source.episodes, 'link')} from ${source.host ?? 'elsewhere'}`
    case 'live':
      return pluralise(source.episodes, 'live recording')
    case 'channel': {
      // The channel is gone if the show stopped following it.
      const of = show.channel ? `${platformNames[show.channel.platform as Platform]} ${show.channel.kind}` : 'channel'
      return `${formatCount(source.episodes)} from its ${of}`
    }
  }
}

const time = (date: Date) => date.toISOString().slice(11, 16)

// When a source's episodes were added. Within a day the times are given, as
// a burst of them is what tells a folder of uploads from episodes added now
// and then: "5 Nov 2026, 00:15–00:31 UTC".
function addedOver({ firstAddedAt, lastAddedAt }: AdminShowSource) {
  const day = formatDate(firstAddedAt)
  if (day !== formatDate(lastAddedAt)) return `${day} – ${formatDate(lastAddedAt)}`
  const from = time(firstAddedAt)
  const to = time(lastAddedAt)
  return `${day}, ${from === to ? from : `${from}–${to}`} UTC`
}

const sourceIcons = {
  upload: Icons.upload,
  link: Icons.link,
  channel: Icons.rss,
  live: Icons.broadcast,
}

export function AdminShows({ shows }: { shows: AdminShow[] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const deferredQuery = useDeferredValue(query)
  const shown = shows
    .filter((show) => matchesSearch(show, deferredQuery))
    .sort((a, b) => sorts[sort].by(b) - sorts[sort].by(a))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shows</CardTitle>
        <CardDescription>
          Every show on the site, and where its episodes came from: files its owner uploaded, links they added one at a
          time, the channel or playlist it follows, or recordings of live broadcasts. Only links and channels are
          downloaded from other sites.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <InputGroup className="max-w-sm">
            <InputGroupAddon>
              <Icons.search />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Search shows"
              placeholder="Search by show or owner"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
          <NativeSelect aria-label="Sort shows" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            {Object.entries(sorts).map(([value, { label }]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {shows.length === 0 ? 'No one has made a show yet.' : `No shows match “${deferredQuery.trim()}”.`}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Show</TableHead>
                <TableHead>Where its episodes came from</TableHead>
                <TableHead className="text-end">Episodes</TableHead>
                <TableHead className="text-end">Audio</TableHead>
                <TableHead>Last added to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((show) => (
                <TableRow key={show.id} className="align-top">
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2">
                        <Link to="/$user/$show" params={showParams(show)} className="font-medium hover:underline">
                          {show.title}
                        </Link>
                        {show.private && <Badge variant="outline">Private</Badge>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {show.owner.name ? `${show.owner.name} · ${show.owner.email}` : show.owner.email}
                      </span>
                      <span className="text-xs text-muted-foreground">Made {formatDate(show.createdAt)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {show.sources.length === 0 ? (
                      <span className="text-muted-foreground">No episodes</span>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {show.sources.map((source) => {
                          const Icon = sourceIcons[source.origin]
                          return (
                            <li key={`${source.origin}:${source.host}`} className="flex items-start gap-2">
                              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                              <div className="flex flex-col">
                                <span>{sourceLabel(source, show)}</span>
                                <span className="text-xs text-muted-foreground">
                                  {source.seconds > 0 && `${formatLength(source.seconds)} · `}
                                  {addedOver(source)}
                                </span>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {show.channel && (
                      <a
                        href={show.channel.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 block truncate text-xs text-muted-foreground hover:underline"
                      >
                        Follows {show.channel.url}
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{formatCount(show.episodes)}</TableCell>
                  <TableCell className="text-end tabular-nums">{show.seconds > 0 ? formatLength(show.seconds) : '–'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {show.lastAddedAt ? formatRelative(show.lastAddedAt) : '–'}
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
