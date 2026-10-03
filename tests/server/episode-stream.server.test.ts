import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publishEpisodeEvent } from '~/server/episode-events.server'
import { flushIntervalMs, podcastEventStream } from '~/server/episode-stream.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db } from '../helpers'

beforeEach(() => resetDb(db))

type Received = { event: string; data: unknown }

// Opens the stream and collects its events until `until` holds.
async function openStream(podcastId: string) {
  const abort = new AbortController()
  const reader = podcastEventStream(podcastId, abort.signal).getReader()
  const decoder = new TextDecoder()
  const received: Received[] = []
  const raw: string[] = []
  let buffer = ''
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value)
      for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        raw.push(block)
        const event = /^event: (.*)$/m.exec(block)?.[1]
        const data = /^data: (.*)$/m.exec(block)?.[1]
        if (event && data) received.push({ event, data: JSON.parse(data) })
      }
    }
  })()
  const close = async () => {
    abort.abort()
    await pump
  }
  return { received, raw, close }
}

const progressOf = (received: Received[], episodeId: string) =>
  received.filter((r) => r.event === 'progress' && (r.data as { episodeId: string }).episodeId === episodeId)

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

describe('podcastEventStream', () => {
  it('starts with a reconnect delay and the progress of episodes in progress', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const pending = await createEpisode(podcast.id, { status: 'pending' })
    await createEpisode(podcast.id, { status: 'ready' })
    const stream = await openStream(podcast.id)
    close = stream.close

    await vi.waitFor(() => expect(stream.received).toHaveLength(1))
    expect(stream.raw[0]).toBe('retry: 3000')
    expect(stream.received[0]).toEqual({ event: 'progress', data: { episodeId: pending.id, progress: null } })
  })

  it("sends its episodes' progress, only the latest of each burst", async () => {
    const podcast = await createPodcast((await createUser()).id)
    const episode = await createEpisode(podcast.id, { status: 'ready' })
    const stream = await openStream(podcast.id)
    close = stream.close
    await new Promise((resolve) => setTimeout(resolve, 50))

    publishEpisodeEvent({ type: 'progress', episodeId: episode.id, progress: { stage: 'fetching' } })
    publishEpisodeEvent({ type: 'progress', episodeId: episode.id, progress: { stage: 'converting', percent: 10 } })
    publishEpisodeEvent({ type: 'progress', episodeId: episode.id, progress: { stage: 'converting', percent: 40 } })

    await vi.waitFor(() => expect(progressOf(stream.received, episode.id)).toHaveLength(1), { timeout: flushIntervalMs * 3 })
    expect(progressOf(stream.received, episode.id)[0]!.data).toEqual({
      episodeId: episode.id,
      progress: { stage: 'converting', percent: 40 },
    })
  })

  it('says when an episode changes, including one added after the stream opened', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const stream = await openStream(podcast.id)
    close = stream.close
    const added = await createEpisode(podcast.id)

    publishEpisodeEvent({ type: 'changed', episodeId: added.id })
    publishEpisodeEvent({ type: 'changed', episodeId: added.id })

    await vi.waitFor(() => expect(stream.received.filter((r) => r.event === 'changed')).toHaveLength(1), {
      timeout: flushIntervalMs * 3,
    })
    expect(stream.received.find((r) => r.event === 'changed')!.data).toEqual({ episodeId: added.id })
  })

  it("leaves out other podcasts' episodes", async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id)
    const other = await createEpisode((await createPodcast(user.id)).id)
    const ours = await createEpisode(podcast.id, { status: 'ready' })
    const stream = await openStream(podcast.id)
    close = stream.close
    await new Promise((resolve) => setTimeout(resolve, 50))

    publishEpisodeEvent({ type: 'changed', episodeId: other.id })
    publishEpisodeEvent({ type: 'changed', episodeId: crypto.randomUUID() })
    publishEpisodeEvent({ type: 'changed', episodeId: ours.id })

    await vi.waitFor(() => expect(stream.received.some((r) => r.event === 'changed')).toBe(true), {
      timeout: flushIntervalMs * 3,
    })
    await new Promise((resolve) => setTimeout(resolve, flushIntervalMs))
    expect(stream.received.filter((r) => r.event === 'changed').map((r) => r.data)).toEqual([{ episodeId: ours.id }])
  })

  it('stops listening and ends when the client goes away', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const stream = await openStream(podcast.id)
    await stream.close()
    // Publishing afterwards reaches no one and doesn't throw.
    expect(() => publishEpisodeEvent({ type: 'changed', episodeId: crypto.randomUUID() })).not.toThrow()
  })
})
