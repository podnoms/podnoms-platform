import { EpisodeRowMenu } from '~/components/episode-row-menu'
import { PublicEpisodeList, PublicEpisodeRow } from '~/components/public-episode-row'
import type { ListenerEpisode } from '~/server/library.server'

// Episodes from any shows (Likes, Following, Explore), each naming its show.
// `ignorable` lists (ones that leave out ignored shows) give each row a menu
// to ignore its show.
export function ListenerEpisodeList({
  episodes,
  ignorable = false,
}: {
  episodes: (ListenerEpisode & { waveform: number[] | null })[]
  ignorable?: boolean
}) {
  return (
    <PublicEpisodeList>
      {episodes.map((episode) => (
        <PublicEpisodeRow
          key={episode.id}
          episode={episode}
          show={episode.show}
          showTitle={episode.show.title}
          showImageUrl={episode.show.imageUrl}
          isOwner={episode.show.isOwner}
          withShow
          actions={
            ignorable ? <EpisodeRowMenu showId={episode.show.id} showTitle={episode.show.title} /> : undefined
          }
        />
      ))}
    </PublicEpisodeList>
  )
}
