// Keeps the site a polite client of the platforms it downloads from. Every
// request that goes to a platform (an episode's download, or listing a
// channel's uploads) waits here for a slot, for all users at once:
//   - at most `downloadConcurrency` at a time, and `perPlatformConcurrency`
//     on any one platform;
//   - at least `downloadDelaySeconds` (± 20%) between starting two on the
//     same platform;
//   - none on a platform that has started refusing us (a RateLimitedError),
//     for 30 minutes, doubling each time up to 6 hours, until one succeeds.
// Waiters with a higher priority go first; among equals, keys (podcasts) take
// turns, so one podcast's big import doesn't hold everyone else up.
//
// The settings are read live (see site-settings.server.ts). State is in
// memory, as the app runs as a single instance.
import '@tanstack/react-start/server-only'
import type { Platform } from '~/lib/platforms'
import type { SiteSettings } from '~/server/db/schema'
import { logger, reportError } from '~/server/logger.server'
import { getSiteSettings } from '~/server/site-settings.server'

// Thrown by a download when the platform is refusing us, rather than just
// failing this download.
export class RateLimitedError extends Error {
  override name = 'RateLimitedError'
}

export const firstCooldownMs = 30 * 60_000
export const maxCooldownMs = 6 * 60 * 60_000
const jitter = 0.2

export type SlotOptions = {
  // Higher goes first.
  priority?: number
  // Waiters with the same priority take turns by key.
  key: string
  // What it is, for the admin page, and an id to find its place in the queue.
  label?: string
  id?: string
}

type Waiter = Required<Pick<SlotOptions, 'priority' | 'key'>> &
  Pick<SlotOptions, 'label' | 'id'> & { platform: Platform; seq: number; start: (slot: Running) => void }

type Running = { platform: Platform; key: string; label?: string; id?: string; startedAt: Date }

let waiting: Waiter[] = []
const running = new Set<Running>()
let seq = 0
// When each platform may next be sent a request.
const nextStartAt = new Map<Platform, number>()
const lastServedAt = new Map<string, number>()
const cooldowns = new Map<Platform, { until: number; ms: number }>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

export async function withDownloadSlot<T>(platform: Platform, options: SlotOptions, run: () => Promise<T>): Promise<T> {
  const slot = await new Promise<Running>((start) => {
    waiting.push({ ...options, platform, priority: options.priority ?? 0, seq: seq++, start })
    changed()
    void pump()
  })
  try {
    const result = await run()
    // Only a request made after the cooldown ended shows the platform's let up.
    const cooldown = cooldowns.get(platform)
    if (cooldown && Date.now() >= cooldown.until) cooldowns.delete(platform)
    return result
  } catch (error) {
    if (error instanceof RateLimitedError) startCooldown(platform)
    throw error
  } finally {
    running.delete(slot)
    changed()
    void pump()
  }
}

function startCooldown(platform: Platform) {
  const previous = cooldowns.get(platform)
  // Several downloads can fail at once; that's one refusal, not several.
  if (previous && Date.now() < previous.until) return
  const ms = previous ? Math.min(previous.ms * 2, maxCooldownMs) : firstCooldownMs
  cooldowns.set(platform, { until: Date.now() + ms, ms })
  logger.warn({ platform, cooldownMinutes: ms / 60_000 }, 'Platform is rate-limiting us; pausing downloads from it')
}

// Lets downloads from the platform go ahead again, e.g. from the admin page.
export function clearCooldown(platform: Platform) {
  cooldowns.delete(platform)
  changed()
  void pump()
}

// The order waiters would go in, were every platform free.
function inTurn(a: Waiter, b: Waiter) {
  return (
    b.priority - a.priority ||
    (lastServedAt.get(a.key) ?? 0) - (lastServedAt.get(b.key) ?? 0) ||
    a.seq - b.seq
  )
}

let lastSettings: SiteSettings | undefined

// The last settings read, if they can't be read now; the queue mustn't stall.
async function readSettings() {
  try {
    return (lastSettings = await getSiteSettings())
  } catch (error) {
    if (!lastSettings) throw error
    logger.warn({ err: error }, 'Could not read the download settings; using the last ones read')
    return lastSettings
  }
}

let pumping = false
let pumpAgain = false

// Starts every waiter that may start now, and sets a timer for the next one
// that will be allowed to.
export async function pump() {
  if (pumping) {
    pumpAgain = true
    return
  }
  pumping = true
  try {
    do {
      pumpAgain = false
      const settings = await readSettings()
      const delayMs = settings.downloadDelaySeconds * 1000
      clearTimeout(timer)
      timer = undefined
      let wakeAt = Infinity
      for (const waiter of [...waiting].sort(inTurn)) {
        if (running.size >= settings.downloadConcurrency) break
        const now = Date.now()
        const { platform } = waiter
        const busy = [...running].filter((r) => r.platform === platform).length
        if (busy >= settings.perPlatformConcurrency) continue
        const blockedUntil = Math.max(cooldowns.get(platform)?.until ?? 0, nextStartAt.get(platform) ?? 0)
        if (now < blockedUntil) {
          wakeAt = Math.min(wakeAt, blockedUntil)
          continue
        }
        waiting = waiting.filter((w) => w !== waiter)
        const spread = delayMs * jitter * (Math.random() * 2 - 1)
        nextStartAt.set(platform, now + delayMs + spread)
        lastServedAt.set(waiter.key, now)
        // Counted as running at once, before anything else is considered.
        const slot = { platform, key: waiter.key, label: waiter.label, id: waiter.id, startedAt: new Date(now) }
        running.add(slot)
        waiter.start(slot)
      }
      if (waiting.length && wakeAt < Infinity) {
        timer = setTimeout(() => void pump(), Math.max(0, wakeAt - Date.now()))
        timer.unref?.()
      }
      changed()
    } while (pumpAgain)
  } catch (error) {
    reportError(error, { msg: 'Could not start downloads' })
    timer = setTimeout(() => void pump(), 10_000)
    timer.unref?.()
  } finally {
    pumping = false
  }
}

function changed() {
  for (const listener of listeners) listener()
}

// Called whenever the queue moves, e.g. to update queued episodes' places.
export function onThrottleChange(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// How many are running or will go before the waiter with this id, or null if
// it isn't waiting.
export function placeInQueue(id: string) {
  const ordered = [...waiting].sort(inTurn)
  const index = ordered.findIndex((w) => w.id === id)
  return index === -1 ? null : index + running.size
}

// For the admin page.
export function throttleStatus() {
  const now = Date.now()
  return {
    running: [...running].map(({ platform, key, label, startedAt }) => ({ platform, key, label: label ?? null, startedAt })),
    waiting: [...waiting].sort(inTurn).map(({ platform, key, label, priority }) => ({ platform, key, label: label ?? null, priority })),
    cooldowns: [...cooldowns]
      .filter(([, cooldown]) => cooldown.until > now)
      .map(([platform, { until }]) => ({ platform, until: new Date(until) })),
  }
}

// Forgets everything; for tests.
export function resetThrottle() {
  clearTimeout(timer)
  timer = undefined
  waiting = []
  running.clear()
  nextStartAt.clear()
  lastServedAt.clear()
  cooldowns.clear()
}
