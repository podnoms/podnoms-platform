// Display formatting shared by the podcast pages and the player.

// A fixed locale and time zone so server and browser render the same text.
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })

export function formatDate(date: Date) {
  return dateFormat.format(date)
}

// 1:05 · 12:30 · 2:00:10
export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// 45 min · 2 h 5 min
export function formatLength(totalSeconds: number) {
  const minutes = Math.max(1, Math.round(totalSeconds / 60))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

export function formatBytes(bytes: number) {
  if (bytes < 1000 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1000 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatTimeLeft(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`
  return `${formatLength(seconds)} left`
}

export function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
