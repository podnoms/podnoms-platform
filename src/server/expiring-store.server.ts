// Short-lived values kept in memory, such as sign-in challenges. Like episode
// progress, they aren't shared between app instances or kept across restarts.
import '@tanstack/react-start/server-only'

export class ExpiringStore<T> {
  readonly #ttlMs: number
  readonly #entries = new Map<string, { value: T; expires: number }>()

  constructor(ttlMs: number) {
    this.#ttlMs = ttlMs
  }

  // Setting a key again replaces its value and restarts its lifetime.
  set(key: string, value: T) {
    const now = Date.now()
    for (const [k, entry] of this.#entries) if (entry.expires <= now) this.#entries.delete(k)
    this.#entries.set(key, { value, expires: now + this.#ttlMs })
  }

  get(key: string): T | undefined {
    const entry = this.#entries.get(key)
    if (!entry) return undefined
    if (entry.expires > Date.now()) return entry.value
    this.#entries.delete(key)
    return undefined
  }

  // Gets a value and removes it, for things that may only be used once.
  take(key: string): T | undefined {
    const value = this.get(key)
    this.#entries.delete(key)
    return value
  }

  delete(key: string) {
    this.#entries.delete(key)
  }
}
