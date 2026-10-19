import { describe, expect, it } from 'vitest'
import { podcastSlugField } from '~/lib/podcast-schema'

describe('podcastSlugField', () => {
  it('takes lowercase letters, numbers and single hyphens, lowercasing and trimming', () => {
    expect(podcastSlugField.parse(' My-Show-2 ')).toBe('my-show-2')
  })

  it.each(['', 'two  words', 'under_score', '-leading', 'trailing-', 'double--hyphen', 'a'.repeat(61), 'admin', 'api'])(
    'refuses %j',
    (slug) => {
      expect(podcastSlugField.safeParse(slug).success).toBe(false)
    },
  )
})
