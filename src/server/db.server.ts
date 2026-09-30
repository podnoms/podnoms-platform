// Server-only boundary. Both the `.server.ts` suffix and the marker import
// below cause the Start build to fail if client code imports this module.
// Only server function handlers (src/functions) should reach in here.
import '@tanstack/react-start/server-only'

export type Item = { id: number; name: string; createdAt: string }

const items: Item[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  name: `Item ${i + 1}`,
  createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
}))

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function queryItems(opts: { q: string; page: number; pageSize: number; sort: 'asc' | 'desc' }) {
  await delay(50)
  const filtered = items
    .filter((i) => i.name.toLowerCase().includes(opts.q.toLowerCase()))
    .sort((a, b) => (opts.sort === 'asc' ? a.id - b.id : b.id - a.id))
  const start = (opts.page - 1) * opts.pageSize
  return { total: filtered.length, items: filtered.slice(start, start + opts.pageSize) }
}

export async function insertItem(name: string) {
  const item: Item = { id: items.length + 1, name, createdAt: new Date().toISOString() }
  items.push(item)
  return item
}

export async function slowReport(ms: number) {
  await delay(ms)
  return { count: items.length, generatedAt: new Date().toISOString(), runtime: process.version }
}
