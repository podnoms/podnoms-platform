import { PublicEpisodeList, PublicEpisodeRow } from '~/components/public-episode-row'
import type { ListenerEpisode } from '~/server/library.server'

// Episodes from any shows (Likes, Following, Explore), each naming its show.
export function ListenerEpisodeList({ episodes }: { episodes: (ListenerEpisode & { waveform: number[] | null })[] }) {
  return (
    <PublicEpisodeList>
      {episodes.map((episode) => (
        <PublicEpisodeRow
          key={episode.id}
          episode={episode}
          showSlug={episode.show.slug}
          showTitle={episode.show.title}
          showImageUrl={episode.show.imageUrl}
          isOwner={episode.show.isOwner}
          withShow
        />
      ))}
    </PublicEpisodeList>
  )
}
