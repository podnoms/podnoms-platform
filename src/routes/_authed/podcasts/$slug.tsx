import { createFileRoute } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { NewEpisodeDialog } from '~/components/new-episode-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '~/components/ui/item'
import { fetchMyPodcast } from '~/functions/podcasts'
import type { EpisodeStatus } from '~/server/db/schema'

export const Route = createFileRoute('/_authed/podcasts/$slug')({
  loader: ({ params }) => fetchMyPodcast({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({ meta: loaderData ? [{ title: `${loaderData.title} · podnoms` }] : [] }),
  component: PodcastPage,
})

const statusLabels: Record<EpisodeStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
}

// A fixed locale and time zone so server and browser render the same text.
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })

function PodcastPage() {
  const podcast = Route.useLoaderData()

  const newEpisodeButton = (
    <NewEpisodeDialog podcastId={podcast.id}>
      <Button>
        <Icons.add />
        New episode
      </Button>
    </NewEpisodeDialog>
  )

  return (
    <div className="flex flex-col gap-6 p-4">
      <header className="flex items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{podcast.title}</h1>
          {podcast.description && <p className="text-muted-foreground">{podcast.description}</p>}
        </div>
        {podcast.episodes.length > 0 && <div className="ml-auto">{newEpisodeButton}</div>}
      </header>
      {podcast.episodes.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.logo />
            </EmptyMedia>
            <EmptyTitle>No episodes yet</EmptyTitle>
            <EmptyDescription>Add your first episode from a YouTube, Mixcloud or SoundCloud link.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{newEpisodeButton}</EmptyContent>
        </Empty>
      ) : (
        <ItemGroup>
          {podcast.episodes.map((episode) => (
            <Item key={episode.id} variant="outline">
              <ItemContent>
                <ItemTitle>{episode.title}</ItemTitle>
                <ItemDescription>
                  Added {dateFormat.format(episode.createdAt)}
                  {episode.sourceUrl && ` · ${episode.sourceUrl}`}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={episode.status === 'failed' ? 'destructive' : 'secondary'}>
                  {statusLabels[episode.status]}
                </Badge>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  )
}
