// Live updates about podcasts' broadcasts, for the event stream their live
// pages listen to (see live-stream.server.ts): a broadcast starting or ending,
// and chat messages. In memory, like episode events.
import '@tanstack/react-start/server-only'
import { EventEmitter } from 'node:events'

// A chat message as it's stored, with who wrote it; each stream works out
// whether its viewer may delete it, and passes on the rest.
export type ChatMessageRecord = {
  id: string
  body: string
  createdAt: Date
  userId: string
  author: { name: string | null; image: string | null }
}

export type LiveEvent =
  // A broadcast started or ended: read the status again.
  | { type: 'status'; podcastId: string }
  | { type: 'message'; podcastId: string; message: ChatMessageRecord }
  | { type: 'deleted'; podcastId: string; messageId: string }

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

// How many have each podcast's live page open, counted by its event streams.
const watching = new Map<string, number>()

export function startWatching(podcastId: string) {
  watching.set(podcastId, (watching.get(podcastId) ?? 0) + 1)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const left = (watching.get(podcastId) ?? 1) - 1
    if (left > 0) watching.set(podcastId, left)
    else watching.delete(podcastId)
  }
}

export function viewerCount(podcastId: string) {
  return watching.get(podcastId) ?? 0
}
