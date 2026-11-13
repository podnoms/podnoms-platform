// The admin page's Shows tab: every show on the site with how its episodes
// got there (uploaded files, links added by hand, a followed channel or
// playlist, live recordings), so an admin can see what someone has been
// adding without querying the database. Callers check isAdmin.
import '@tanstack/react-start/server-only'
import { count, desc, eq, max, min, sql } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { channelItems, channels, episodes, liveBroadcasts, shows, users } from '~/server/db/schema'
import { showRefColumns } from '~/server/shows.server'

// How an episode came to be: a file its owner uploaded, a link they added, an
// upload of the channel or playlist the show follows, or a live recording.
export type EpisodeOrigin = 'upload' | 'link' | 'channel' | 'live'

export type AdminShowSource = {
  origin: EpisodeOrigin
  // The site a link is on ("youtube.com"); null for the other origins.
  host: string | null
  episodes: number
  seconds: number
  firstAddedAt: Date
  lastAddedAt: Date
}

export type AdminShow = Awaited<ReturnType<typeof listAdminShows>>[number]

// Each show with its owner, the channel it follows and its episodes counted
// by where they came from; the shows added to most recently come first, then
// those with no episodes, newest first.
export async function listAdminShows() {
  // Uploads have no source link, but neither do live recordings; channels'
  // episodes have one, as links do, so those two are told apart first.
  const origin = sql<EpisodeOrigin>`case
    when exists (select 1 from ${channelItems} where ${channelItems.episodeId} = ${episodes.id}) then 'channel'
    when exists (select 1 from ${liveBroadcasts} where ${liveBroadcasts.episodeId} = ${episodes.id}) then 'live'
    when ${episodes.sourceUrl} is null then 'upload'
    else 'link'
  end`
  const host = sql<string | null>`substring(lower(${episodes.sourceUrl}) from '^https?://(?:www\\.)?([^/:?#]+)')`
  const [showRows, sourceRows] = await Promise.all([
    db
      .select({
        id: shows.id,
        title: shows.title,
        ...showRefColumns,
        private: shows.private,
        createdAt: shows.createdAt,
        ownerName: users.name,
        ownerEmail: users.email,
        channelKind: channels.kind,
        channelPlatform: channels.platform,
        channelUrl: channels.url,
      })
      .from(shows)
      .innerJoin(users, eq(users.id, shows.userId))
      .leftJoin(channels, eq(channels.showId, shows.id))
      .orderBy(desc(shows.createdAt)),
    db
      .select({
        showId: episodes.showId,
        origin,
        host,
        episodes: count(),
        seconds: sql`coalesce(sum(${episodes.durationSeconds}), 0)`.mapWith(Number),
        firstAddedAt: min(episodes.createdAt),
        lastAddedAt: max(episodes.createdAt),
      })
      .from(episodes)
      // Joined so the columns above are written with their tables' names,
      // which the subqueries in `origin` need.
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .groupBy(episodes.showId, sql`2`, sql`3`),
  ])

  const sources = new Map<string, AdminShowSource[]>()
  for (const row of sourceRows) {
    if (!row.firstAddedAt || !row.lastAddedAt) continue
    const list = sources.get(row.showId) ?? []
    sources.set(row.showId, list)
    // Only links are split by site: a channel's are all its platform's.
    const linkHost = row.origin === 'link' ? row.host : null
    const same = list.find((source) => source.origin === row.origin && source.host === linkHost)
    if (same) {
      same.episodes += row.episodes
      same.seconds += row.seconds
      if (row.firstAddedAt < same.firstAddedAt) same.firstAddedAt = row.firstAddedAt
      if (row.lastAddedAt > same.lastAddedAt) same.lastAddedAt = row.lastAddedAt
    } else {
      list.push({
        origin: row.origin,
        host: linkHost,
        episodes: row.episodes,
        seconds: row.seconds,
        firstAddedAt: row.firstAddedAt,
        lastAddedAt: row.lastAddedAt,
      })
    }
  }

  // A show has at most one channel, so the join doesn't repeat shows.
  return showRows
    .map(({ ownerName, ownerEmail, channelKind, channelPlatform, channelUrl, ...show }) => {
      const list = (sources.get(show.id) ?? []).sort((a, b) => b.episodes - a.episodes)
      return {
        ...show,
        owner: { name: ownerName, email: ownerEmail },
        channel: channelUrl ? { kind: channelKind!, platform: channelPlatform!, url: channelUrl } : null,
        episodes: list.reduce((total, source) => total + source.episodes, 0),
        seconds: list.reduce((total, source) => total + source.seconds, 0),
        lastAddedAt: list.reduce<Date | null>(
          (latest, source) => (!latest || source.lastAddedAt > latest ? source.lastAddedAt : latest),
          null,
        ),
        sources: list,
      }
    })
    .sort((a, b) => (b.lastAddedAt?.getTime() ?? 0) - (a.lastAddedAt?.getTime() ?? 0))
}
