import { describe, expect, it } from 'vitest'
import { directoryReadiness, isDirectoryListing, isReady, isSubcategoryOf, languageName } from '~/lib/podcast-directories'
import { directoryDetailsSchema, directoryLinkSchema } from '~/lib/podcast-schema'

const complete: Parameters<typeof directoryReadiness>[0] = {
  title: 'Show',
  description: '<p>About it</p>',
  artwork: '/images/a.jpg',
  category: 'Music',
  language: 'en',
  author: 'Ann',
  publishedEpisodes: 1,
  private: false,
  ownerEmail: 'ann@example.com',
}

const failing = (podcast: typeof complete) =>
  directoryReadiness(podcast)
    .filter((item) => !item.ok)
    .map((item) => item.id)

describe('directoryReadiness', () => {
  it('is ready when everything is there', () => {
    expect(failing(complete)).toEqual([])
    expect(isReady(directoryReadiness(complete))).toBe(true)
  })

  it('is still ready without an owner email, which only some directories need', () => {
    const items = directoryReadiness({ ...complete, ownerEmail: null })
    expect(failing({ ...complete, ownerEmail: null })).toEqual(['ownerEmail'])
    expect(isReady(items)).toBe(true)
  })

  it.each([
    ['category', { category: null }],
    ['artwork', { artwork: null }],
    ['description', { description: '<p> </p>' }],
    ['author', { author: '  ' }],
    ['episode', { publishedEpisodes: 0 }],
    ['listed', { private: true }],
  ])('is not ready without %s', (id, change) => {
    const podcast = { ...complete, ...change }
    expect(failing(podcast)).toEqual([id])
    expect(isReady(directoryReadiness(podcast))).toBe(false)
  })
})

describe('isDirectoryListing', () => {
  it.each([
    ['apple', 'https://podcasts.apple.com/ie/podcast/the-show/id123456789'],
    ['spotify', 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk'],
    ['podcastIndex', 'https://podcastindex.org/podcast/920666'],
    ['amazon', 'https://music.amazon.co.uk/podcasts/abc'],
    ['youtube', 'https://music.youtube.com/playlist?list=PL123'],
    ['pocketCasts', 'https://pca.st/podcast/abc'],
  ] as const)('accepts a %s listing', (id, link) => {
    expect(isDirectoryListing(id, link)).toBe(true)
  })

  it.each([
    ['spotify', 'https://open.spotify.com/episode/abc'],
    ['apple', 'https://evil.example/podcasts.apple.com'],
    ['apple', 'http://podcasts.apple.com/podcast/id1'],
    ['spotify', 'not a url'],
  ] as const)('rejects %s link %s', (id, link) => {
    expect(isDirectoryListing(id, link)).toBe(false)
  })
})

describe('directoryDetailsSchema', () => {
  const input = {
    id: 'p1',
    category: 'TV & Film',
    subcategory: 'Film Reviews',
    language: 'en-ie',
    explicit: false,
    author: ' Ann ',
    ownerEmail: ' Ann@Example.com ',
  }

  it('accepts and tidies valid details', () => {
    expect(directoryDetailsSchema.parse(input)).toEqual({ ...input, author: 'Ann', ownerEmail: 'ann@example.com' })
  })

  it('turns an empty subcategory or email into null', () => {
    expect(directoryDetailsSchema.parse({ ...input, subcategory: '', ownerEmail: '' })).toMatchObject({
      subcategory: null,
      ownerEmail: null,
    })
  })

  it.each([
    ['a category that is not Apple’s', { category: 'Podcasts' }],
    ['a subcategory from another category', { subcategory: 'Stand-Up' }],
    ['an unknown language', { language: 'xx' }],
    ['a bad email', { ownerEmail: 'nope' }],
  ])('rejects %s', (_, change) => {
    expect(directoryDetailsSchema.safeParse({ ...input, ...change }).success).toBe(false)
  })
})

describe('directoryLinkSchema', () => {
  it('accepts an empty link, to forget the listing', () => {
    expect(directoryLinkSchema.safeParse({ id: 'p1', directory: 'apple', link: '' }).success).toBe(true)
  })

  it("rejects a link that isn't on that directory", () => {
    const link = 'https://open.spotify.com/show/abc'
    expect(directoryLinkSchema.safeParse({ id: 'p1', directory: 'apple', link }).success).toBe(false)
  })
})

describe('helpers', () => {
  it('knows which subcategories belong to which category', () => {
    expect(isSubcategoryOf('Music', 'Music History')).toBe(true)
    expect(isSubcategoryOf('Music', 'Stand-Up')).toBe(false)
    expect(isSubcategoryOf('Nope', 'Music History')).toBe(false)
  })

  it('names languages', () => {
    expect(languageName('en-ie')).toBe('English (Ireland)')
    expect(languageName('ga')).toBe('Irish')
  })
})

describe('the 0013 migration', () => {
  it("keeps the same top-level categories as appleCategories", async () => {
    const { readFileSync } = await import('node:fs')
    const { categoryNames } = await import('~/lib/podcast-directories')
    const sql = readFileSync('drizzle/0013_directory_details.sql', 'utf8')
    const listed = [...sql.slice(sql.indexOf('NOT IN')).matchAll(/'([^']+)'/g)].map((match) => match[1])
    expect(listed.sort()).toEqual([...categoryNames].sort())
  })
})
