// Small helpers for text fields.

// `text` with `insert` put in place of the selection from `start` to `end`
// (the cursor, when they're equal), and where the cursor goes after it. Null
// if the result would be longer than `maxLength`.
export function insertText(text: string, insert: string, start: number, end: number, maxLength: number) {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  const next = text.slice(0, from) + insert + text.slice(to)
  if (next.length > maxLength) return null
  return { text: next, cursor: from + insert.length }
}
