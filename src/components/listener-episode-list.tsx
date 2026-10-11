import { PublicEpisodeList, PublicEpisodeRow } from '~/components/public-episode-row'
import type { ListenerEpisode } from '~/server/library.server'

// Episodes from any podcasts (Likes, Following, Explore), each naming its podcast.
export function ListenerEpisodeList({ episodes }: { episodes: (ListenerEpisode & { waveform: number[] | null })[] }) {
  return (
    <PublicEpisodeList>
      {episodes.map((episode) => (
        <PublicEpisodeRow
          key={episode.id}
          episode={episode}
          podcastSlug={episode.podcast.slug}
          podcastTitle={episode.podcast.title}
          podcastImageUrl={episode.podcast.imageUrl}
          isOwner={episode.podcast.isOwner}
          showPodcast
        />
      ))}
    </PublicEpisodeList>
  )
}
