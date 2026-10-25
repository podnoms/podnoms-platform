import { useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { PageHeading } from '~/components/page-section'
import { PlaylistDialog } from '~/components/playlist-dialog'
import { Button } from '~/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '~/components/ui/item'
import { fetchMyPlaylists, savePlaylist } from '~/functions/playlists'
import { pluralise } from '~/lib/format'
import { pageTitle } from '~/lib/branding'

// The user's playlists, most recently changed first, and a way to make one.
export const Route = createFileRoute('/_authed/playlists')({
  loader: () => fetchMyPlaylists({ data: {} }),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Playlists') }] }),
  component: PlaylistsPage,
})

function PlaylistsPage() {
  const playlists = Route.useLoaderData()
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const userSlug = session!.user.slug

  const newButton = (
    <Button onClick={() => setCreating(true)}>
      <Icons.add />
      New playlist
    </Button>
  )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading icon={<Icons.playlist />} title="Playlists" description="Episodes from any podcasts, to play one after another." />
        {playlists.length > 0 && newButton}
      </div>

      {playlists.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.playlist />
            </EmptyMedia>
            <EmptyTitle>No playlists yet</EmptyTitle>
            <EmptyDescription>
              Make one here, or press Save on any episode to put it in a playlist.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{newButton}</EmptyContent>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {playlists.map((playlist) => (
            <Item key={playlist.id} variant="outline" asChild>
              <Link to="/u/$slug/playlists/$playlistSlug" params={{ slug: userSlug, playlistSlug: playlist.slug }}>
                <ItemMedia variant="icon">
                  <Icons.playlist />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{playlist.title}</ItemTitle>
                  <ItemDescription>
                    {pluralise(playlist.episodeCount, 'episode')} · {playlist.private ? 'Private' : 'Public'}
                  </ItemDescription>
                </ItemContent>
              </Link>
            </Item>
          ))}
        </ItemGroup>
      )}

      <PlaylistDialog
        open={creating}
        onOpenChange={setCreating}
        onSave={async (details) => {
          const created = await savePlaylist({ data: { ...details, description: details.description ?? '' } })
          setCreating(false)
          await navigate({ to: '/u/$slug/playlists/$playlistSlug', params: { slug: userSlug, playlistSlug: created.slug } })
        }}
      />
    </div>
  )
}
