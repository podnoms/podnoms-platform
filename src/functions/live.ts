// Server functions for live broadcasts: the public live page and its chat,
// and the owner's Go live dialog (see live.server.ts).
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { deleteChatSchema, endBroadcastSchema, livePodcastSchema, liveTitleSchema, postChatSchema } from '~/lib/live-schema'
import { getSession } from '~/server/auth.server'
import {
  addChatMessage,
  createLiveKey,
  deleteChatMessage,
  endBroadcast,
  getLiveSettings,
  getOpenBroadcast,
  gifConfig,
  liveEnabled,
  reconnectGraceMs,
  listChat,
  revokeLiveKey,
  setLiveTitle,
} from '~/server/live.server'
import { getPublicPodcast } from '~/server/podcasts.server'

async function viewerId() {
  const session = await getSession(getRequest())
  return session?.user?.id ?? null
}

async function requireUserId() {
  const userId = await viewerId()
  if (!userId) throw new Error('You need to be signed in')
  return userId
}

// A podcast's live page: what's on, if anything, and its chat so far.
export const fetchLivePage = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    if (!liveEnabled()) throw notFound()
    const userId = await viewerId()
    const podcast = await getPublicPodcast(data.slug, userId)
    if (!podcast) throw notFound()
    const broadcast = await getOpenBroadcast(podcast.id)
    return {
      podcast: {
        id: podcast.id,
        title: podcast.title,
        slug: podcast.slug,
        imageUrl: podcast.imageUrl,
        author: podcast.author,
        private: podcast.private,
      },
      broadcast,
      chat: broadcast ? await listChat(podcast, broadcast.id, userId) : [],
      isOwner: userId === podcast.userId,
      signedIn: userId !== null,
      // The GIF provider viewers search, if one is set up.
      gifs: gifConfig(),
      // How long a dropped stream is waited for before the show ends by itself.
      reconnectGraceMinutes: reconnectGraceMs / 60_000,
    }
  })

// The chat so far, after the page's event stream reconnects.
export const fetchLiveChat = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string(), broadcastId: z.string() }))
  .handler(async ({ data }) => {
    const userId = await viewerId()
    const podcast = await getPublicPodcast(data.slug, userId)
    if (!podcast) throw notFound()
    return listChat(podcast, data.broadcastId, userId)
  })

export const postLiveChat = createServerFn({ method: 'POST' })
  .validator(postChatSchema)
  .handler(async ({ data }) => {
    const message = await addChatMessage(await requireUserId(), data.broadcastId, data.body, data.gif)
    if (!message) throw notFound()
    return message
  })

export const removeLiveChat = createServerFn({ method: 'POST' })
  .validator(deleteChatSchema)
  .handler(async ({ data }) => {
    if (!(await deleteChatMessage(await requireUserId(), data.messageId))) throw notFound()
  })

// The owner has finished: ends their interrupted broadcast now, telling viewers.
export const endMyBroadcast = createServerFn({ method: 'POST' })
  .validator(endBroadcastSchema)
  .handler(async ({ data }) => {
    if (!(await endBroadcast(await requireUserId(), data.broadcastId))) throw notFound()
  })

// The owner's Go live dialog.
export const fetchMyLive = createServerFn({ method: 'GET' })
  .validator(livePodcastSchema)
  .handler(async ({ data }) => {
    const settings = await getLiveSettings(await requireUserId(), data.podcastId)
    if (!settings) throw notFound()
    return settings
  })

// A new key for OBS, replacing the old.
export const createMyLiveKey = createServerFn({ method: 'POST' })
  .validator(livePodcastSchema)
  .handler(async ({ data }) => {
    const created = await createLiveKey(await requireUserId(), data.podcastId)
    if (!created) throw notFound()
    return created
  })

export const revokeMyLiveKey = createServerFn({ method: 'POST' })
  .validator(livePodcastSchema)
  .handler(async ({ data }) => {
    if (!(await revokeLiveKey(await requireUserId(), data.podcastId))) throw notFound()
  })

export const saveMyLiveTitle = createServerFn({ method: 'POST' })
  .validator(liveTitleSchema)
  .handler(async ({ data }) => {
    if (!(await setLiveTitle(await requireUserId(), data.podcastId, data.title))) throw notFound()
  })
