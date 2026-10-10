import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from '~/lib/platforms'
import type { SiteSettings } from '~/server/db/schema'
import {
  clearCooldown,
  firstCooldownMs,
  placeInQueue,
  RateLimitedError,
  resetThrottle,
  throttleStatus,
  withDownloadSlot,
  type SlotOptions,
} from '~/server/download-throttle.server'

const settings: SiteSettings = {
  id: 'global',
  downloadConcurrency: 3,
  perPlatformConcurrency: 2,
  downloadDelaySeconds: 0,
  channelCheckHours: 6,
  downloadRateLimit: null,
  smtpHost: null,
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: null,
  smtpPassword: null,
  emailFrom: null,
  updatedAt: new Date(0),
}

vi.mock('~/server/site-settings.server', () => ({ getSiteSettings: async () => settings }))

beforeEach(() => {
  vi.useFakeTimers()
  // No jitter, so delays are exact.
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  resetThrottle()
  Object.assign(settings, { downloadConcurrency: 3, perPlatformConcurrency: 2, downloadDelaySeconds: 0 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// A download that runs until told to finish or fail.
function job(platform: Platform, options: Partial<SlotOptions> = {}) {
  const state = {
    started: false,
    finish: () => {},
    fail: (_error: Error) => {},
  }
  const done = withDownloadSlot(platform, { key: 'podcast', ...options }, () => {
    state.started = true
    return new Promise<void>((resolve, reject) => {
      state.finish = resolve
      state.fail = reject
    })
  })
  done.catch(() => {})
  return Object.assign(state, { done })
}

// Lets the queue catch up with what's happened.
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

describe('withDownloadSlot', () => {
  it('runs at most downloadConcurrency at once, across platforms', async () => {
    const jobs = (['youtube', 'mixcloud', 'soundcloud', 'other'] as const).map((p) => job(p))
    await settle()
    expect(jobs.map((j) => j.started)).toEqual([true, true, true, false])

    jobs[0]!.finish()
    await settle()
    expect(jobs[3]!.started).toBe(true)
  })

  it('runs at most perPlatformConcurrency from one platform, without holding up others', async () => {
    const youtube = [job('youtube'), job('youtube'), job('youtube')]
    const mixcloud = job('mixcloud')
    await settle()
    expect(youtube.map((j) => j.started)).toEqual([true, true, false])
    expect(mixcloud.started).toBe(true)
  })

  it('waits downloadDelaySeconds between starts on the same platform, but not across platforms', async () => {
    settings.downloadDelaySeconds = 10
    const [first, second] = [job('youtube'), job('youtube')]
    const mixcloud = job('mixcloud')
    await settle()
    expect(first.started).toBe(true)
    expect(second.started).toBe(false)
    expect(mixcloud.started).toBe(true)

    await settle(9_900)
    expect(second.started).toBe(false)
    await settle(100)
    expect(second.started).toBe(true)
  })

  it('spreads the delay by up to 20% either way', async () => {
    settings.downloadDelaySeconds = 10
    vi.mocked(Math.random).mockReturnValue(1)
    job('youtube')
    const second = job('youtube')
    await settle(11_900)
    expect(second.started).toBe(false)
    await settle(100)
    expect(second.started).toBe(true)
  })

  it('starts higher priorities first', async () => {
    settings.downloadConcurrency = 1
    const running = job('youtube')
    await settle()
    const low = job('youtube', { priority: 0 })
    const high = job('youtube', { priority: 1 })
    await settle()
    expect(running.started).toBe(true)
    running.finish()
    await settle()
    expect(high.started).toBe(true)
    expect(low.started).toBe(false)
  })

  it('takes turns between keys of the same priority', async () => {
    settings.downloadConcurrency = 1
    const running = job('youtube', { key: 'big-import' })
    await settle()
    const more = [job('youtube', { key: 'big-import' }), job('youtube', { key: 'big-import' })]
    const other = job('youtube', { key: 'someone-else' })
    await settle()
    running.finish()
    await settle()
    expect(other.started).toBe(true)
    expect(more.map((j) => j.started)).toEqual([false, false])
    other.finish()
    await settle()
    expect(more.map((j) => j.started)).toEqual([true, false])
  })

  it('passes on what the download returns or throws', async () => {
    await expect(withDownloadSlot('other', { key: 'k' }, async () => 42)).resolves.toBe(42)
    await expect(withDownloadSlot('other', { key: 'k' }, async () => Promise.reject(new Error('nope')))).rejects.toThrow(
      'nope',
    )
    // A failure that isn't a refusal doesn't hold anything up.
    const next = job('other')
    await settle()
    expect(next.started).toBe(true)
  })
})

describe('when a platform refuses us', () => {
  it('pauses that platform for 30 minutes, then doubles the pause each time', async () => {
    const refused = job('youtube')
    await settle()
    refused.fail(new RateLimitedError('HTTP Error 429'))
    await settle()

    const waiting = job('youtube')
    const mixcloud = job('mixcloud')
    await settle()
    expect(waiting.started).toBe(false)
    expect(mixcloud.started).toBe(true)
    expect(throttleStatus().cooldowns).toEqual([{ platform: 'youtube', until: new Date(Date.now() + firstCooldownMs) }])

    await settle(firstCooldownMs)
    expect(waiting.started).toBe(true)
    waiting.fail(new RateLimitedError('HTTP Error 429'))
    await settle()

    const after = job('youtube')
    await settle(firstCooldownMs)
    expect(after.started).toBe(false)
    await settle(firstCooldownMs)
    expect(after.started).toBe(true)
  })

  it('goes back to a 30 minute pause once a download gets through', async () => {
    const refused = job('youtube')
    await settle()
    refused.fail(new RateLimitedError('429'))
    await settle(firstCooldownMs)

    const succeeds = job('youtube')
    await settle()
    succeeds.finish()
    await settle()

    const refusedAgain = job('youtube')
    await settle()
    refusedAgain.fail(new RateLimitedError('429'))
    await settle()
    expect(throttleStatus().cooldowns[0]!.until).toEqual(new Date(Date.now() + firstCooldownMs))
  })

  it('counts refusals of downloads running at the same time as one', async () => {
    const [a, b] = [job('youtube'), job('youtube')]
    await settle()
    a.fail(new RateLimitedError('429'))
    b.fail(new RateLimitedError('429'))
    await settle()
    expect(throttleStatus().cooldowns[0]!.until).toEqual(new Date(Date.now() + firstCooldownMs))
  })

  it('can be resumed by hand', async () => {
    const refused = job('youtube')
    await settle()
    refused.fail(new RateLimitedError('429'))
    await settle()
    const waiting = job('youtube')
    await settle()
    clearCooldown('youtube')
    await settle()
    expect(waiting.started).toBe(true)
    expect(throttleStatus().cooldowns).toEqual([])
  })
})

describe('placeInQueue', () => {
  it('counts what is running and what will go first', async () => {
    settings.downloadConcurrency = 1
    job('youtube', { id: 'running' })
    await settle()
    job('youtube', { id: 'low', priority: 0 })
    job('youtube', { id: 'high', priority: 1 })
    await settle()
    expect(placeInQueue('running')).toBeNull()
    expect(placeInQueue('high')).toBe(1)
    expect(placeInQueue('low')).toBe(2)
    expect(placeInQueue('unknown')).toBeNull()
  })
})
