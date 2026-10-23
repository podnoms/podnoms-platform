// Server functions for playlists (see playlists.server.ts): a user's own,
// which only they can change, and the pages of public ones, which anyone can
// see.
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import {
  createPlaylistSchema,
  playlistEpisodeSchema,
  reorderPlaylistSchema,
  updatePlaylistSchema,
} from '~/lib/playlist-schema'
import { getSession } from '~/server/auth.server'
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylistPage,
  listMyPlaylists,
  removeFromPlaylist,
  reorderPlaylist,
  updatePlaylist,
} from '~/server/playlists.server'
import { withEpisodeTags } from '~/server/tags-store.server'
import { withWaveforms } from '~/server/waveforms.server'

async function viewerId() {
  const session = await getSession(getRequest())
  return session?.user?.id ?? null
}

async function requireUserId() {
  const userId = await viewerId()
  if (!userId) throw new Error('You need to be signed in')
  return userId
}

// The user's playlists; given an episode, with whether each has it.
export const fetchMyPlaylists = createServerFn({ method: 'GET' })
  .validator(z.object({ episodeId: z.string().min(1).optional() }))
  .handler(async ({ data }) => listMyPlaylists(await requireUserId(), data.episodeId))

// Returns the new playlist's id and slug.
export const savePlaylist = createServerFn({ method: 'POST' })
  .validator(createPlaylistSchema)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const { episodeId, ...details } = data
    const playlist = await createPlaylist(userId, details)
    if (episodeId) await addToPlaylist(userId, playlist.id, episodeId)
    return playlist
  })

export const editPlaylist = createServerFn({ method: 'POST' })
  .validator(updatePlaylistSchema)
  .handler(async ({ data }) => {
    const { id, ...details } = data
    if (!(await updatePlaylist(await requireUserId(), id, details))) throw notFound()
  })

export const removePlaylist = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (!(await deletePlaylist(await requireUserId(), data.id))) throw notFound()
  })

export const addPlaylistEpisode = createServerFn({ method: 'POST' })
  .validator(playlistEpisodeSchema)
  .handler(async ({ data }) => {
    if (!(await addToPlaylist(await requireUserId(), data.playlistId, data.episodeId))) throw notFound()
  })

export const removePlaylistEpisode = createServerFn({ method: 'POST' })
  .validator(playlistEpisodeSchema)
  .handler(async ({ data }) => {
    if (!(await removeFromPlaylist(await requireUserId(), data.playlistId, data.episodeId))) throw notFound()
  })

export const reorderPlaylistEpisodes = createServerFn({ method: 'POST' })
  .validator(reorderPlaylistSchema)
  .handler(async ({ data }) => {
    if (!(await reorderPlaylist(await requireUserId(), data.playlistId, data.episodeIds))) throw notFound()
  })

// A playlist's page: public ones for anyone, private ones for their owner.
export const fetchPlaylistPage = createServerFn({ method: 'GET' })
  .validator(z.object({ userSlug: z.string(), playlistSlug: z.string() }))
  .handler(async ({ data }) => {
    const page = await getPlaylistPage(data.userSlug, data.playlistSlug, await viewerId())
    if (!page) throw notFound()
    return { ...page, episodes: await withWaveforms(await withEpisodeTags(page.episodes)) }
  })
