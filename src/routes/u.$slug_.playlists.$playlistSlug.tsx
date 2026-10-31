import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { usePlayer, type PlayerEpisode, type PlayerQueue } from '~/components/player/player-provider'
import { PlaylistDialog } from '~/components/playlist-dialog'
import { PublicEpisodeList, PublicEpisodeRow } from '~/components/public-episode-row'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { editPlaylist, fetchPlaylistPage, removePlaylist, removePlaylistEpisode, reorderPlaylistEpisodes } from '~/functions/playlists'
import { formatLength, initials, pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { siteHead } from '~/lib/page-meta'
import { siteInfo } from '~/lib/site'
import { brandingFrom } from '~/lib/branding'

// A playlist's page: public ones for anyone, private ones for their owner,
// who can also rename, reorder and delete it here. Play all plays it through.
export const Route = createFileRoute('/u/$slug_/playlists/$playlistSlug')({
  staticData: { publicPage: true },
  loader: ({ params }) => fetchPlaylistPage({ data: { userSlug: params.slug, playlistSlug: params.playlistSlug } }),
  head: ({ loaderData: playlist, matches }) => {
    if (!playlist) return {}
    const branding = brandingFrom(matches)
    const title = `${playlist.title} · ${branding.name}`
    const site = siteInfo(matches)
    if (playlist.private || !site?.origin) return { meta: [{ title }, ...(playlist.private ? [{ name: 'robots', content: 'noindex' }] : [])] }
    return siteHead({
      site: branding,
      origin: site.origin,
      path: playlistPath(playlist.owner.slug, playlist.slug),
      title,
      description: playlist.description || `A playlist by ${playlist.owner.name ?? `@${playlist.owner.slug}`} on ${branding.name}`,
    })
  },
  component: PlaylistPage,
})

const playlistPath = (userSlug: string, playlistSlug: string) => `/u/${userSlug}/playlists/${playlistSlug}`

function PlaylistPage() {
  const playlist = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const player = usePlayer()
  // Kept here, so moving and removing show at once.
  const [episodes, setEpisodes] = useState(playlist.episodes)
  useEffect(() => setEpisodes(playlist.episodes), [playlist.episodes])
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const href = playlistPath(playlist.owner.slug, playlist.slug)
  const queue: PlayerQueue = {
    title: playlist.title,
    href,
    episodes: episodes.flatMap((episode): PlayerEpisode[] =>
      episode.audioUrl
        ? [
            {
              id: episode.id,
              title: episode.title,
              audioUrl: episode.audioUrl,
              imageUrl: episode.imageUrl ?? episode.show.imageUrl,
              showTitle: episode.show.title,
              slug: episode.slug,
              showSlug: episode.show.slug,
              isOwner: episode.show.isOwner,
              positionSeconds: episode.positionSeconds,
            },
          ]
        : [],
    ),
  }
  const playingThis = player.queue?.href === href
  const total = episodes.reduce((sum, episode) => sum + (episode.durationSeconds ?? 0), 0)
  const cover = episodes.find((episode) => episode.imageUrl ?? episode.show.imageUrl)
  const coverUrl = cover ? (cover.imageUrl ?? cover.show.imageUrl) : null

  function playFrom(episodeId: string) {
    const index = queue.episodes.findIndex((episode) => episode.id === episodeId)
    if (index >= 0) player.playQueue(queue, index)
  }

  async function move(index: number, by: -1 | 1) {
    const next = [...episodes]
    const [moved] = next.splice(index, 1)
    next.splice(index + by, 0, moved!)
    const before = episodes
    setEpisodes(next)
    try {
      await reorderPlaylistEpisodes({ data: { playlistId: playlist.id, episodeIds: next.map((episode) => episode.id) } })
    } catch {
      setEpisodes(before)
    }
  }

  async function remove(episodeId: string) {
    const before = episodes
    setEpisodes(episodes.filter((episode) => episode.id !== episodeId))
    try {
      await removePlaylistEpisode({ data: { playlistId: playlist.id, episodeId } })
    } catch {
      setEpisodes(before)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-6">
      <section className="flex flex-col gap-6 sm:flex-row sm:items-end">
        {coverUrl ? (
          <img src={imageSrc(coverUrl, 224)} alt="" className="size-40 shrink-0 rounded-xl object-cover shadow-md sm:size-56" />
        ) : (
          <div className="flex size-40 shrink-0 items-center justify-center rounded-xl bg-muted sm:size-56">
            <Icons.playlist className="size-12 text-muted-foreground" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Playlist</p>
            {playlist.private && (
              <Badge variant="secondary">
                <Icons.private />
                Private
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{playlist.title}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Link to="/u/$slug" params={{ slug: playlist.owner.slug }} className="flex items-center gap-1.5 hover:text-foreground">
              <Avatar className="size-5">
                {playlist.owner.image && <AvatarImage src={imageSrc(playlist.owner.image, 32)} alt="" />}
                <AvatarFallback className="text-[9px]">{initials(playlist.owner.name, null)}</AvatarFallback>
              </Avatar>
              {playlist.owner.name ?? `@${playlist.owner.slug}`}
            </Link>
            <span>· {pluralise(episodes.length, 'episode')}</span>
            {total > 0 && <span>· {formatLength(total)}</span>}
          </p>
          {playlist.description && <p className="max-w-prose text-sm whitespace-pre-line">{playlist.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {queue.episodes.length > 0 && (
              <Button
                size="lg"
                className="rounded-full"
                onClick={() => (playingThis ? player.toggle() : player.playQueue(queue))}
              >
                {playingThis && player.playing ? <Icons.pause /> : <Icons.play className="fill-current" />}
                {playingThis && player.playing ? 'Pause' : 'Play all'}
              </Button>
            )}
            {playlist.isOwner && (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Icons.edit />
                  Edit
                </Button>
                <Button variant="ghost" size="icon" title="Delete playlist" onClick={() => setConfirmDelete(true)}>
                  <Icons.delete />
                  <span className="sr-only">Delete playlist</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {episodes.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icons.playlist />
            </EmptyMedia>
            <EmptyTitle>Nothing in it yet</EmptyTitle>
            {playlist.isOwner && (
              <EmptyDescription>Press Save on any episode to put it here.</EmptyDescription>
            )}
          </EmptyHeader>
        </Empty>
      ) : (
        <PublicEpisodeList>
          {episodes.map((episode, index) => (
            <PublicEpisodeRow
              key={episode.id}
              episode={episode}
              showSlug={episode.show.slug}
              showTitle={episode.show.title}
              showImageUrl={episode.show.imageUrl}
              isOwner={episode.show.isOwner}
              withShow
              onPlay={() => playFrom(episode.id)}
              actions={
                playlist.isOwner && (
                  <OwnerActions
                    first={index === 0}
                    last={index === episodes.length - 1}
                    onMove={(by) => void move(index, by)}
                    onRemove={() => void remove(episode.id)}
                  />
                )
              }
            />
          ))}
        </PublicEpisodeList>
      )}

      {playlist.isOwner && (
        <>
          <PlaylistDialog
            open={editing}
            onOpenChange={setEditing}
            initial={{ title: playlist.title, description: playlist.description, private: playlist.private }}
            onSave={async (details) => {
              await editPlaylist({ data: { id: playlist.id, ...details, description: details.description ?? '' } })
              setEditing(false)
              await router.invalidate()
            }}
          />
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{playlist.title}”?</AlertDialogTitle>
                <AlertDialogDescription>The playlist goes, but its episodes stay where they are.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={async () => {
                    await removePlaylist({ data: { id: playlist.id } })
                    await navigate({ to: '/playlists' })
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  )
}

function OwnerActions({
  first,
  last,
  onMove,
  onRemove,
}: {
  first: boolean
  last: boolean
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-1 sm:ml-auto">
      <Button variant="ghost" size="icon-sm" disabled={first} title="Move up" onClick={() => onMove(-1)}>
        <Icons.moveUp />
        <span className="sr-only">Move up</span>
      </Button>
      <Button variant="ghost" size="icon-sm" disabled={last} title="Move down" onClick={() => onMove(1)}>
        <Icons.moveDown />
        <span className="sr-only">Move down</span>
      </Button>
      <Button variant="ghost" size="icon-sm" title="Remove from playlist" onClick={onRemove}>
        <Icons.close />
        <span className="sr-only">Remove from playlist</span>
      </Button>
    </div>
  )
}
