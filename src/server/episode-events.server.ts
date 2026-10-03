// Live updates about episodes being processed, for the event stream that
// podcast and episode pages listen to while something is in progress (see
// /api/podcasts/$slug/events). In memory, like the processing itself.
import '@tanstack/react-start/server-only'
import { EventEmitter } from 'node:events'
import type { EpisodeProgress } from '~/server/episode-processor.server'

export type EpisodeEvent =
  // How far along the episode is; null once it's no longer queued or running.
  | { type: 'progress'; episodeId: string; progress: EpisodeProgress | null }
  // Its stored details changed (status, title, slug, audio…): reload them.
  | { type: 'changed'; episodeId: string }

const events = new EventEmitter()
// One listener per open page; there's no sensible limit to warn at.
events.setMaxListeners(0)

export function publishEpisodeEvent(event: EpisodeEvent) {
  events.emit('event', event)
}

export function subscribeToEpisodeEvents(listener: (event: EpisodeEvent) => void) {
  events.on('event', listener)
  return () => {
    events.off('event', listener)
  }
}
