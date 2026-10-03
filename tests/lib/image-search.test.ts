import { describe, expect, it } from 'vitest'
import { imageSearchQueries, searchWords } from '~/lib/image-search'

describe('searchWords', () => {
  it('keeps the meaningful words, lowercased, without accents, numbers or repeats', () => {
    expect(searchWords('#82 The Café Sessions: Café Jazz 2012 — Episode 4 ft. DJ Ed')).toEqual(['cafe', 'sessions', 'jazz'])
  })
})

describe('imageSearchQueries', () => {
  it('goes from the title, to the description, to the context, to music', () => {
    expect(
      imageSearchQueries({
        title: 'Deep House Sunset',
        description: '<p>Recorded on the beach. The beach was <strong>packed</strong>, beach party!</p>',
        context: "Fergal's Mixyboos",
      }),
    ).toEqual(['deep house', 'deep', 'house', 'sunset', 'beach', 'recorded', 'fergal', 'mixyboos', 'music'])
  })

  it('falls back to music when there is nothing to go on', () => {
    expect(imageSearchQueries({ title: 'Episode 12', description: '', context: '' })).toEqual(['music'])
    expect(imageSearchQueries({})).toEqual(['music'])
  })

  it("leaves out description words already in the title, and doesn't repeat searches", () => {
    expect(imageSearchQueries({ title: 'September', description: 'September in September, mostly rain', context: 'Rain' })).toEqual([
      'september',
      'mostly',
      'rain',
      'music',
    ])
  })
})
