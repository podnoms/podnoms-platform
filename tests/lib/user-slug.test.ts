import { describe, expect, it } from 'vitest'
import { mentionedSlugs, mentionsAsText, userSlugBase, userSlugSchema } from '~/lib/user-slug'

describe('user slugs', () => {
  it('accepts lowercase letters, digits and single hyphens, 2 to 30 long, lowercasing what is typed', () => {
    expect(userSlugSchema.parse(' Fergal-Moran ')).toBe('fergal-moran')
    for (const bad of ['a', 'two--hyphens', '-start', 'end-', 'with space', 'x'.repeat(31), 'admin'])
      expect(userSlugSchema.safeParse(bad).success, bad).toBe(false)
  })

  it('makes a base from a name or email, leaving room for a number', () => {
    expect(userSlugBase('Fergal Moran')).toBe('fergal-moran')
    expect(userSlugBase('Éanna Ó Sé')).toBe('eanna-o-se')
    expect(userSlugBase('✨')).toBe('user')
    expect(userSlugBase('x'.repeat(40))).toHaveLength(26)
  })
})

describe('mentions', () => {
  it('finds each mentioned slug once, lowercased, but not email addresses', () => {
    expect(mentionedSlugs('@Ann hi @bob-2, @ann again; mail ann@example.com or @@cat')).toEqual(['ann', 'bob-2'])
  })

  it('shows stored mentions as @slug, leaving unknown ones', () => {
    const id = '0b1c2d3e-0000-4000-8000-000000000000'
    const other = '0b1c2d3e-0000-4000-8000-000000000001'
    expect(mentionsAsText(`Hi <@${id}> and <@${other}>`, { [id]: { slug: 'ann', name: null } })).toBe(
      `Hi @ann and <@${other}>`,
    )
  })
})
