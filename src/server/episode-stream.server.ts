// A podcast's episode events as a server-sent event stream: what podcast and
// episode pages listen to, instead of polling, while something is processing.
import '@tanstack/react-start/server-only'
import { and, eq, isNotNull, or, inArray } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes } from '~/server/db/schema'
import { subscribeToEpisodeEvents, type EpisodeEvent } from '~/server/episode-events.server'
import { getEpisodeProgress, type EpisodeProgress } from '~/server/episode-processor.server'

// Progress changes many times a second; pages get the latest at most this often.
export const flushIntervalMs = 500
// A comment now and then stops proxies closing an idle connection.
export const heartbeatIntervalMs = 20_000

const encoder = new TextEncoder()
const message = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

export function podcastEventStream(podcastId: string, signal: AbortSignal) {
  // Whether each episode seen belongs to this podcast. Episodes added after
  // the stream opened are looked up the first time they come by.
  const belongs = new Map<string, Promise<boolean>>()
  const isOurs = (episodeId: string) => {
    let known = belongs.get(episodeId)
    if (!known) {
      known = db
        .select({ podcastId: episodes.podcastId })
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .then(([row]) => row?.podcastId === podcastId)
      belongs.set(episodeId, known)
    }
    return known
  }

  const progress = new Map<string, EpisodeProgress | null>()
  const changed = new Set<string>()
  let unsubscribe = () => {}
  let flushTimer: ReturnType<typeof setInterval> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        unsubscribe()
        clearInterval(flushTimer)
        clearInterval(heartbeatTimer)
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      }
      if (signal.aborted) return close()
      signal.addEventListener('abort', close, { once: true })

      // Listen first, so nothing that happens during the snapshot is missed.
      unsubscribe = subscribeToEpisodeEvents((event: EpisodeEvent) => {
        void isOurs(event.episodeId).then((ours) => {
          if (!ours) return
          if (event.type === 'progress') progress.set(event.episodeId, event.progress)
          else changed.add(event.episodeId)
        })
      })

      // Reconnect after 3s if the connection drops, then the progress so far.
      controller.enqueue(encoder.encode('retry: 3000\n\n'))
      const ours = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.podcastId, podcastId))
      for (const { id } of ours) belongs.set(id, Promise.resolve(true))
      const inProgress = await db
        .select({ id: episodes.id })
        .from(episodes)
        .where(
          and(
            eq(episodes.podcastId, podcastId),
            or(inArray(episodes.status, ['pending', 'processing']), isNotNull(episodes.replacement)),
          ),
        )
      for (const { id } of inProgress) if (!progress.has(id)) progress.set(id, getEpisodeProgress(id))

      const flush = () => {
        try {
          for (const [episodeId, value] of progress) controller.enqueue(message('progress', { episodeId, progress: value }))
          for (const episodeId of changed) controller.enqueue(message('changed', { episodeId }))
        } catch {
          return close()
        }
        progress.clear()
        changed.clear()
      }
      flush()
      flushTimer = setInterval(flush, flushIntervalMs)
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          close()
        }
      }, heartbeatIntervalMs)
    },
    cancel() {
      unsubscribe()
      clearInterval(flushTimer)
      clearInterval(heartbeatTimer)
    },
  })
}

export const eventStreamHeaders = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  // Tells nginx-style proxies not to buffer the stream.
  'X-Accel-Buffering': 'no',
}
