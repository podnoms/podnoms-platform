// Follows a podcast's live event stream (/api/podcasts/$slug/live/events):
// the broadcast starting and ending, its chat as it's written and deleted,
// and how many are watching. Starts from what the page loaded.
import { useEffect, useRef, useState } from 'react'
import { fetchLiveChat } from '~/functions/live'
import type { ChatMessage, OpenBroadcast } from '~/server/live.server'

type Wire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] }

const broadcastFrom = (broadcast: Wire<OpenBroadcast> | null): OpenBroadcast | null =>
  broadcast && { ...broadcast, startedAt: new Date(broadcast.startedAt) }

const messageFrom = (message: Wire<ChatMessage>): ChatMessage => ({ ...message, createdAt: new Date(message.createdAt) })

export function useLiveEvents(slug: string, initial: { broadcast: OpenBroadcast | null; chat: ChatMessage[] }) {
  const [broadcast, setBroadcast] = useState(initial.broadcast)
  const [chat, setChat] = useState(initial.chat)
  const [viewers, setViewers] = useState<number | null>(null)
  const broadcastId = useRef(initial.broadcast?.id ?? null)

  useEffect(() => {
    const source = new EventSource(`/api/podcasts/${encodeURIComponent(slug)}/live/events?watching=1`)
    let opened = false
    const data = <T,>(event: Event) => JSON.parse((event as MessageEvent<string>).data) as T

    source.addEventListener('open', () => {
      // Messages may have been missed while disconnected.
      if (opened && broadcastId.current) {
        void fetchLiveChat({ data: { slug, broadcastId: broadcastId.current } }).then(setChat, () => {})
      }
      opened = true
    })
    source.addEventListener('status', (event) => {
      const next = broadcastFrom(data<{ broadcast: Wire<OpenBroadcast> | null }>(event).broadcast)
      // A new broadcast has a new chat; one that ended keeps its chat on screen.
      if (next && next.id !== broadcastId.current) setChat([])
      broadcastId.current = next?.id ?? null
      setBroadcast(next)
    })
    source.addEventListener('message', (event) => {
      const message = messageFrom(data<Wire<ChatMessage>>(event))
      setChat((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]))
    })
    source.addEventListener('deleted', (event) => {
      const { messageId } = data<{ messageId: string }>(event)
      setChat((current) => current.filter((message) => message.id !== messageId))
    })
    source.addEventListener('viewers', (event) => setViewers(data<{ count: number }>(event).count))
    // The browser reconnects by itself after an error.
    return () => source.close()
  }, [slug])

  return { broadcast, chat, setChat, viewers }
}

// Calls `onStart` when the podcast starts broadcasting, while `active`: for
// its page, to send visitors to the live page.
export function useLiveStart(slug: string, active: boolean, onStart: () => void) {
  const latest = useRef(onStart)
  latest.current = onStart

  useEffect(() => {
    if (!active) return
    const source = new EventSource(`/api/podcasts/${encodeURIComponent(slug)}/live/events`)
    source.addEventListener('status', (event) => {
      const { broadcast } = JSON.parse((event as MessageEvent<string>).data) as { broadcast: unknown }
      if (broadcast) latest.current()
    })
    return () => source.close()
  }, [slug, active])
}
