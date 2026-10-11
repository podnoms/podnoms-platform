import { PublicEpisodeRow } from '~/components/public-episode-row'
import { ItemGroup } from '~/components/ui/item'
import type { ListenerEpisode } from '~/server/library.server'

// Episodes from any podcasts (Likes, Following, Explore), each naming its podcast.
export function ListenerEpisodeList({ episodes }: { episodes: ListenerEpisode[] }) {
  return (
    <ItemGroup className="gap-3">
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
    </ItemGroup>
  )
}
