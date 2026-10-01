import { describe, expect, it } from 'vitest'
import { firstFreeSlug, slugify } from '~/lib/slug'

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('Fish Go Deep Radio 2026-19', 'x')).toBe('fish-go-deep-radio-2026-19')
  })

  it('folds accents to plain letters', () => {
    expect(slugify('Café Crème Brûlée', 'x')).toBe('cafe-creme-brulee')
  })

  it('collapses runs of punctuation and trims hyphens from the ends', () => {
    expect(slugify('  --Hello,   World!!--  ', 'x')).toBe('hello-world')
  })

  it('keeps slugs to 60 characters without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(59)} bcd`, 'x')
    expect(slug).toBe('a'.repeat(59))
    expect(slugify('word '.repeat(30), 'x').length).toBeLessThanOrEqual(60)
    expect(slugify('word '.repeat(30), 'x')).not.toMatch(/-$/)
  })

  it('uses the fallback when nothing usable is left', () => {
    expect(slugify('', 'podcast')).toBe('podcast')
    expect(slugify('!!! ???', 'episode')).toBe('episode')
    expect(slugify('日本語', 'episode')).toBe('episode')
  })
})

describe('firstFreeSlug', () => {
  it('returns the base when it is free', () => {
    expect(firstFreeSlug('show', new Set(['other']))).toBe('show')
  })

  it('numbers from 2 when the base is taken', () => {
    expect(firstFreeSlug('show', new Set(['show']))).toBe('show-2')
  })

  it('skips numbers that are taken and fills gaps', () => {
    expect(firstFreeSlug('show', new Set(['show', 'show-2', 'show-3']))).toBe('show-4')
    expect(firstFreeSlug('show', new Set(['show', 'show-3']))).toBe('show-2')
  })
})
