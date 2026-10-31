// Live updates about shows' broadcasts, for the event stream their live
// pages listen to (see live-stream.server.ts): a broadcast starting or ending,
// and chat messages. In memory, like episode events.
import '@tanstack/react-start/server-only'
import { EventEmitter } from 'node:events'
import type { ChatGif } from '~/lib/gifs'

// A chat message as it's stored, with who wrote it; each stream works out
// whether its viewer may delete it, and passes on the rest.
export type ChatMessageRecord = {
  id: string
  body: string
  createdAt: Date
  userId: string
  author: { name: string | null; image: string | null }
  gif: ChatGif | null
}

export type LiveEvent =
  // A broadcast started or ended: read the status again.
  | { type: 'status'; showId: string }
  | { type: 'message'; showId: string; message: ChatMessageRecord }
  | { type: 'deleted'; showId: string; messageId: string }

const events = new EventEmitter()
// One listener per open page; there's no sensible limit to warn at.
events.setMaxListeners(0)

export function publishLiveEvent(event: LiveEvent) {
  events.emit('event', event)
}

export function subscribeToLiveEvents(listener: (event: LiveEvent) => void) {
  events.on('event', listener)
  return () => {
    events.off('event', listener)
  }
}

// How many have each show's live page open on the site, counted by its event streams.
const watching = new Map<string, number>()

export function startWatching(showId: string) {
  watching.set(showId, (watching.get(showId) ?? 0) + 1)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const left = (watching.get(showId) ?? 1) - 1
    if (left > 0) watching.set(showId, left)
    else watching.delete(showId)
  }
}

// The mobile app asks for the live page every few seconds rather than holding
// a stream, so someone on it counts until they've stopped asking for this long.
const appViewerTtlMs = 15_000
const appViewers = new Map<string, Map<string, number>>()

export function noteAppViewer(showId: string, userId: string) {
  const viewers = appViewers.get(showId) ?? new Map<string, number>()
  viewers.set(userId, Date.now() + appViewerTtlMs)
  appViewers.set(showId, viewers)
}

function appViewerCount(showId: string) {
  const viewers = appViewers.get(showId)
  if (!viewers) return 0
  const now = Date.now()
  for (const [userId, expires] of viewers) if (expires <= now) viewers.delete(userId)
  if (viewers.size === 0) appViewers.delete(showId)
  return viewers.size
}

export function viewerCount(showId: string) {
  return (watching.get(showId) ?? 0) + appViewerCount(showId)
}
