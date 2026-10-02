// The player's volume, remembered in this browser between visits.
export type Volume = { level: number; muted: boolean }

export const defaultVolume: Volume = { level: 1, muted: false }

const STORAGE_KEY = 'player-volume'

export function readStoredVolume(): Volume {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Volume> | null
    const level = stored?.level
    if (typeof level !== 'number' || !Number.isFinite(level)) return defaultVolume
    return { level: Math.min(Math.max(level, 0), 1), muted: stored?.muted === true }
  } catch {
    // Storage can be unavailable (private mode, blocked site data), or hold junk.
    return defaultVolume
  }
}

export function storeVolume(volume: Volume) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(volume))
  } catch {
    // Still applies for this page view.
  }
}
