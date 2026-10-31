import { describe, expect, it } from 'vitest'
import { showSlugField } from '~/lib/show-schema'

describe('showSlugField', () => {
  it('takes lowercase letters, numbers and single hyphens, lowercasing and trimming', () => {
    expect(showSlugField.parse(' My-Show-2 ')).toBe('my-show-2')
  })

  it.each(['', 'two  words', 'under_score', '-leading', 'trailing-', 'double--hyphen', 'a'.repeat(61), 'admin', 'api'])(
    'refuses %j',
    (slug) => {
      expect(showSlugField.safeParse(slug).success).toBe(false)
    },
  )
})
