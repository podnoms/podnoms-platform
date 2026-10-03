// Listens to a podcast's episode event stream (/api/podcasts/$slug/events)
// while `active`, rather than polling: live progress, and word of when an
// episode's details change so the page can reload them once.
import { useEffect, useRef, useState } from 'react'
import type { EpisodeProgress } from '~/server/episode-processor.server'

type Handlers = {
  onProgress: (episodeId: string, progress: EpisodeProgress | null) => void
  onChanged: (episodeId: string) => void
  // Events may have been missed while disconnected.
  onReconnect: () => void
}

export function useEpisodeEvents(podcastSlug: string, active: boolean, handlers: Handlers) {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    if (!active) return
    const source = new EventSource(`/api/podcasts/${encodeURIComponent(podcastSlug)}/events`)
    let opened = false
    source.addEventListener('open', () => {
      if (opened) latest.current.onReconnect()
      opened = true
    })
    source.addEventListener('progress', (event) => {
      const { episodeId, progress } = JSON.parse((event as MessageEvent<string>).data) as {
        episodeId: string
        progress: EpisodeProgress | null
      }
      latest.current.onProgress(episodeId, progress)
    })
    source.addEventListener('changed', (event) => {
      const { episodeId } = JSON.parse((event as MessageEvent<string>).data) as { episodeId: string }
      latest.current.onChanged(episodeId)
    })
    // The browser reconnects by itself after an error.
    return () => source.close()
  }, [podcastSlug, active])
}

// Live progress layered over what the page loaded, which it replaces each
// time the page reloads.
export function withLiveProgress<T extends { id: string; progress: EpisodeProgress | null }>(
  episode: T,
  live: Record<string, EpisodeProgress | null>,
): T {
  return episode.id in live ? { ...episode, progress: live[episode.id]! } : episode
}

// For a page showing episodes: their live progress while `active`, keyed by
// episode, cleared whenever `loaded` (the page's data) is replaced. `reload`
// is called once, shortly after episodes' details change or the stream
// reconnects, with the episodes that changed (empty after a reconnect).
export function useLiveProgress(
  podcastSlug: string,
  active: boolean,
  loaded: unknown,
  reload: (changed: Set<string>) => void,
) {
  const [live, setLive] = useState<Record<string, EpisodeProgress | null>>({})
  useEffect(() => setLive({}), [loaded])

  const latestReload = useRef(reload)
  latestReload.current = reload
  const pending = useRef<{ changed: Set<string>; timer: ReturnType<typeof setTimeout> } | null>(null)
  const scheduleReload = (episodeId?: string) => {
    pending.current ??= {
      changed: new Set(),
      timer: setTimeout(() => {
        const { changed } = pending.current!
        pending.current = null
        latestReload.current(changed)
      }, 250),
    }
    if (episodeId) pending.current.changed.add(episodeId)
  }
  useEffect(() => () => clearTimeout(pending.current?.timer), [])

  useEpisodeEvents(podcastSlug, active, {
    onProgress: (episodeId, progress) => setLive((current) => ({ ...current, [episodeId]: progress })),
    onChanged: (episodeId) => scheduleReload(episodeId),
    onReconnect: () => scheduleReload(),
  })
  return live
}
