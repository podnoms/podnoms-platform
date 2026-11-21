import { describe, expect, it } from 'vitest'
import { showByline } from '~/lib/byline'

describe('showByline', () => {
  it("is the author the owner gave the show", () => {
    expect(showByline({ credit: 'Deepvibes Radio', ownerSlug: 'adam-dunbar' })).toBe('Deepvibes Radio')
  })

  it("is otherwise the owner's @slug, never their name", () => {
    expect(showByline({ credit: null, ownerSlug: 'adam-dunbar' })).toBe('@adam-dunbar')
    expect(showByline({ credit: '  ', ownerSlug: 'adam-dunbar' })).toBe('@adam-dunbar')
  })
})
