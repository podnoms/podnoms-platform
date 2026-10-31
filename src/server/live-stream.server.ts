// A show's live events as a server-sent event stream, for its live page:
// the broadcast starting and ending, chat messages as they're written and
// deleted, and how many are watching. The show's own page listens too, to
// send its visitors to the live page when a broadcast starts; only live pages
// (`watching`) count as watching.
import '@tanstack/react-start/server-only'
import { heartbeatIntervalMs } from '~/server/episode-stream.server'
import { startWatching, subscribeToLiveEvents, viewerCount, type LiveEvent } from '~/server/live-events.server'
import { chatMessageFor, getOpenBroadcast } from '~/server/live.server'

// How often the number watching is sent, when it has changed.
export const viewersIntervalMs = 5000

const encoder = new TextEncoder()
const message = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

export function liveEventStream(
  show: { id: string; userId: string },
  viewerId: string | null,
  watching: boolean,
  signal: AbortSignal,
) {
  let unsubscribe = () => {}
  let stopWatching = () => {}
  let viewersTimer: ReturnType<typeof setInterval> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    unsubscribe()
    stopWatching()
    clearInterval(viewersTimer)
    clearInterval(heartbeatTimer)
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        stop()
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      }
      const send = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk)
        } catch {
          close()
        }
      }
      if (signal.aborted) return close()
      signal.addEventListener('abort', close, { once: true })

      // A page that misses one gets the status again when it reconnects.
      const sendStatus = () =>
        getOpenBroadcast(show.id).then(
          (broadcast) => send(message('status', { broadcast })),
          () => {},
        )
      unsubscribe = subscribeToLiveEvents((event: LiveEvent) => {
        if (event.showId !== show.id) return
        if (event.type === 'status') void sendStatus()
        else if (event.type === 'message') send(message('message', chatMessageFor(event.message, viewerId, show.userId)))
        else send(message('deleted', { messageId: event.messageId }))
      })
      if (watching) stopWatching = startWatching(show.id)

      // Reconnect after 3s if the connection drops; then where things stand,
      // as something may have changed while it was down.
      send(encoder.encode('retry: 3000\n\n'))
      void sendStatus()
      let viewers = -1
      const sendViewers = () => {
        const count = viewerCount(show.id)
        if (count === viewers) return
        viewers = count
        send(message('viewers', { count }))
      }
      sendViewers()
      viewersTimer = setInterval(sendViewers, viewersIntervalMs)
      heartbeatTimer = setInterval(() => send(encoder.encode(': ping\n\n')), heartbeatIntervalMs)
    },
    cancel() {
      stop()
    },
  })
}
