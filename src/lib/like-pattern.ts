// SQL LIKE patterns from what people type, with LIKE's wildcards (% and _)
// and its escape character taken literally.
export function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, '\\$&')
}

// A pattern matching `text` anywhere.
export function containing(text: string) {
  return `%${escapeLike(text)}%`
}
