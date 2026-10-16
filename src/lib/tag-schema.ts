import { z } from 'zod'

export const maxTags = 10
export const maxTagLength = 50

export type Tag = { id: string; name: string; slug: string }
export type TagSort = 'newest' | 'popular'

// Keep one spelling across shows and episodes, including repeated whitespace.
export function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export const tagNameSchema = z
  .string()
  .transform(normalizeTagName)
  .pipe(z.string().min(1, 'Enter a tag name').max(maxTagLength, `Keep tags under ${maxTagLength + 1} characters`))

export const tagNamesSchema = z
  .array(tagNameSchema)
  .max(maxTags, `Add up to ${maxTags} tags`)
  .transform((names) => [...new Set(names)])
