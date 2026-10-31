// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveEvents, useLiveStart } from '~/hooks/use-live-events'

vi.mock('~/functions/live', () => ({ fetchLiveChat: vi.fn() }))

// The page's live event stream, sent status events by hand.
const sources: FakeEventSource[] = []
class FakeEventSource {
  listeners = new Map<string, (event: MessageEvent<string>) => void>()
  closed = false
  constructor(readonly url: string) {
    sources.push(this)
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, listener)
  }
  close() {
    this.closed = true
  }
  status(live: boolean) {
    const broadcast = live ? { id: 'b1', title: 'On air', startedAt: new Date().toISOString(), interruptedAt: null } : null
    this.listeners.get('status')?.({ data: JSON.stringify({ broadcast }) } as MessageEvent<string>)
  }
}

beforeEach(() => {
  sources.length = 0
  vi.stubGlobal('EventSource', FakeEventSource)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useLiveStart', () => {
  it('fires when the show goes live while the page is open', () => {
    const onStart = vi.fn()
    renderHook(() => useLiveStart('show', true, false, onStart))
    expect(sources[0]!.url).toBe('/api/shows/show/live/events')

    sources[0]!.status(false)
    expect(onStart).not.toHaveBeenCalled()
    sources[0]!.status(true)
    expect(onStart).toHaveBeenCalledTimes(1)
    // Still live: not again.
    sources[0]!.status(true)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it("doesn't fire for a broadcast that was on when the page opened, only for the next", () => {
    const onStart = vi.fn()
    renderHook(() => useLiveStart('show', true, true, onStart))

    sources[0]!.status(true)
    expect(onStart).not.toHaveBeenCalled()
    sources[0]!.status(false)
    sources[0]!.status(true)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('fires for a broadcast that started between loading the page and connecting', () => {
    const onStart = vi.fn()
    renderHook(() => useLiveStart('show', true, false, onStart))
    // The stream's first status says it's live already.
    sources[0]!.status(true)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('returns whether the show is live, following its status', () => {
    const { result } = renderHook(() => useLiveStart('show', true, true, vi.fn()))
    expect(result.current).toBe(true)
    act(() => sources[0]!.status(false))
    expect(result.current).toBe(false)
    act(() => sources[0]!.status(true))
    expect(result.current).toBe(true)
  })

  it("doesn't listen while inactive, and stops listening when unmounted", () => {
    renderHook(() => useLiveStart('show', false, false, vi.fn()))
    expect(sources).toEqual([])

    const { unmount } = renderHook(() => useLiveStart('show', true, false, vi.fn()))
    unmount()
    expect(sources[0]!.closed).toBe(true)
  })
})

describe('useLiveEvents', () => {
  const broadcast = { id: 'b1', title: 'On air', startedAt: new Date(), interruptedAt: null }

  it('says the show has ended when the broadcast being watched ends, until the next starts', () => {
    const { result } = renderHook(() => useLiveEvents('show', { broadcast, chat: [] }))
    expect(sources[0]!.url).toBe('/api/shows/show/live/events?watching=1')
    expect(result.current.ended).toBe(false)

    act(() => sources[0]!.status(false))
    expect(result.current).toMatchObject({ broadcast: null, ended: true })
    act(() => sources[0]!.status(true))
    expect(result.current.ended).toBe(false)
  })

  it("doesn't say a show ended when there was none", () => {
    const { result } = renderHook(() => useLiveEvents('show', { broadcast: null, chat: [] }))
    act(() => sources[0]!.status(false))
    expect(result.current.ended).toBe(false)
  })
})
