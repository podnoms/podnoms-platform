// A button that puts an episode in the user's playlists: its menu lists them,
// ticking those it's in, and picking one adds or removes it; "New playlist…"
// makes one with the episode in it. Signed-out visitors are asked to sign in.
import { useState } from 'react'
import { useNavigate, useRouteContext } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { PlaylistDialog } from '~/components/playlist-dialog'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Spinner } from '~/components/ui/spinner'
import { addPlaylistEpisode, fetchMyPlaylists, removePlaylistEpisode, savePlaylist } from '~/functions/playlists'

type MyPlaylist = Awaited<ReturnType<typeof fetchMyPlaylists>>[number]

export function AddToPlaylistButton({ episodeId, size = 'sm' }: { episodeId: string; size?: 'sm' | 'default' }) {
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const [playlists, setPlaylists] = useState<MyPlaylist[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)

  const button = (onClick?: () => void) => (
    <Button variant="outline" size={size} title="Save to a playlist" onClick={onClick}>
      <Icons.playlist />
      <span className="sr-only sm:not-sr-only">Save</span>
    </Button>
  )

  if (!session) return button(() => void navigate({ to: '.', search: (prev) => ({ ...prev, login: true as const }) }))

  async function load() {
    setFailed(false)
    try {
      setPlaylists(await fetchMyPlaylists({ data: { episodeId } }))
    } catch {
      setFailed(true)
    }
  }

  async function toggle(playlist: MyPlaylist, add: boolean) {
    const change = (contains: boolean) =>
      setPlaylists((current) => current?.map((item) => (item.id === playlist.id ? { ...item, contains } : item)) ?? null)
    change(add)
    try {
      await (add ? addPlaylistEpisode : removePlaylistEpisode)({ data: { playlistId: playlist.id, episodeId } })
    } catch {
      change(!add)
    }
  }

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && void load()}>
        <DropdownMenuTrigger asChild>{button()}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Save to a playlist</DropdownMenuLabel>
          {failed ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Your playlists couldn't be loaded.</p>
          ) : playlists === null ? (
            <div className="flex justify-center py-2">
              <Spinner />
            </div>
          ) : (
            playlists.map((playlist) => (
              <DropdownMenuCheckboxItem
                key={playlist.id}
                checked={playlist.contains}
                // Stays open, to tick more than one.
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => void toggle(playlist, checked)}
              >
                <span className="min-w-0 flex-1 truncate">{playlist.title}</span>
                {playlist.private && <Icons.private className="size-3.5 text-muted-foreground" />}
              </DropdownMenuCheckboxItem>
            ))
          )}
          {playlists && playlists.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Icons.add />
            New playlist…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PlaylistDialog
        open={creating}
        onOpenChange={setCreating}
        onSave={async (details) => {
          await savePlaylist({ data: { ...details, description: details.description ?? '', episodeId } })
          setCreating(false)
        }}
      />
    </>
  )
}
