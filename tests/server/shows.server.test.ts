import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { shows } from '~/server/db/schema'
import {
  createShow,
  getShowBySlug,
  getPublicShow,
  listShows,
  resetFeedKey,
  setShowPrivacy,
  updateDirectoryDetails,
  updateDirectoryLink,
  ShowSlugError,
  updateShow,
} from '~/server/shows.server'
import { imagePath } from '~/server/storage.server'
import { resetDb } from '../db'
import {
  createEpisode,
  createShow as insertShow,
  createUser,
  db,
  exists,
  stageTestImage,
  storeTestImage,
} from '../helpers'

beforeEach(() => resetDb(db))

async function getRow(id: string) {
  const [row] = await db.select().from(shows).where(eq(shows.id, id))
  return row!
}

describe('createShow', () => {
  it('creates the show with a slug from its title', async () => {
    const user = await createUser()
    const show = await createShow(user.id, { title: 'My Great Show' })
    expect(show).toEqual({ id: expect.any(String), title: 'My Great Show', slug: 'my-great-show', imageUrl: null })
    expect((await getRow(show.id)).userId).toBe(user.id)
  })

  it('stores the plain-text description as HTML', async () => {
    const show = await createShow((await createUser()).id, { title: 'T', description: 'One\n\nTwo <b>' })
    expect((await getRow(show.id)).description).toBe('<p>One</p><p>Two &lt;b&gt;</p>')
  })

  it('makes slugs unique across all users', async () => {
    const a = await createUser()
    const b = await createUser()
    expect((await createShow(a.id, { title: 'Show' })).slug).toBe('show')
    expect((await createShow(b.id, { title: 'Show' })).slug).toBe('show-2')
    expect((await createShow(a.id, { title: 'SHOW!' })).slug).toBe('show-3')
  })

  it('falls back to "show" when the title has no usable characters', async () => {
    expect((await createShow((await createUser()).id, { title: '🎙️' })).slug).toBe('show')
  })

  it("doesn't take the name of one of the site's own pages", async () => {
    const user = await createUser()
    expect((await createShow(user.id, { title: 'Explore' })).slug).toBe('explore-2')
    expect((await createShow(user.id, { title: 'Settings' })).slug).toBe('settings-2')
  })
})

describe('listShows', () => {
  it("lists only the user's shows, by title", async () => {
    const user = await createUser()
    await insertShow(user.id, { title: 'Zebra' })
    await insertShow(user.id, { title: 'Aardvark' })
    await insertShow((await createUser()).id, { title: 'Not mine' })
    expect((await listShows(user.id)).map((p) => p.title)).toEqual(['Aardvark', 'Zebra'])
  })

  it("uses the newest ready episode's artwork when the show has none", async () => {
    const user = await createUser()
    const show = await insertShow(user.id)
    await createEpisode(show.id, { status: 'ready', imageUrl: '/images/old.jpg', createdAt: new Date('2026-01-01') })
    await createEpisode(show.id, { status: 'ready', imageUrl: '/images/new.jpg', createdAt: new Date('2026-02-01') })
    await createEpisode(show.id, { status: 'failed', imageUrl: '/images/failed.jpg', createdAt: new Date('2026-03-01') })
    expect((await listShows(user.id))[0]!.imageUrl).toBe('/images/new.jpg')
  })

  it('says when each was made and when its latest ready episode came out', async () => {
    const user = await createUser()
    const quiet = await insertShow(user.id, { title: 'Quiet', createdAt: new Date('2026-03-01') })
    const busy = await insertShow(user.id, { title: 'Busy', createdAt: new Date('2026-01-01') })
    await createEpisode(busy.id, { status: 'ready', publishedAt: new Date('2026-02-01') })
    await createEpisode(busy.id, { status: 'ready', createdAt: new Date('2026-04-01') })
    await createEpisode(busy.id, { status: 'failed', createdAt: new Date('2026-05-01') })
    await createEpisode(quiet.id, { status: 'pending', createdAt: new Date('2026-06-01') })

    expect(await listShows(user.id)).toMatchObject([
      { title: 'Busy', createdAt: new Date('2026-01-01'), latestEpisodeAt: new Date('2026-04-01') },
      { title: 'Quiet', createdAt: new Date('2026-03-01'), latestEpisodeAt: null },
    ])
  })

  it("prefers the show's own artwork", async () => {
    const user = await createUser()
    const show = await insertShow(user.id, { imageUrl: '/images/own.jpg' })
    await createEpisode(show.id, { status: 'ready', imageUrl: '/images/episode.jpg' })
    expect((await listShows(user.id))[0]!.imageUrl).toBe('/images/own.jpg')
  })
})

describe('getShowBySlug', () => {
  it("finds the user's show and nobody else's", async () => {
    const owner = await createUser()
    const show = await insertShow(owner.id, { slug: 'mine' })
    expect((await getShowBySlug(owner.id, 'mine'))?.id).toBe(show.id)
    expect(await getShowBySlug((await createUser()).id, 'mine')).toBeNull()
    expect(await getShowBySlug(owner.id, 'missing')).toBeNull()
  })
})

describe('updateShow', () => {
  it('updates the title and sanitised description, keeping the slug', async () => {
    const user = await createUser()
    const show = await insertShow(user.id, { title: 'Old', slug: 'old' })
    const ok = await updateShow(user.id, {
      id: show.id,
      title: 'New',
      description: '<p>Hi<script>x</script></p>',
    })
    expect(ok).toBe(true)
    const row = await getRow(show.id)
    expect(row).toMatchObject({ title: 'New', slug: 'old', description: '<p>Hi</p>' })
  })

  it('changes the slug when a new one is given', async () => {
    const user = await createUser()
    const show = await insertShow(user.id, { title: 'Show', slug: 'old' })
    expect(await updateShow(user.id, { id: show.id, title: 'Show', slug: 'new-name' })).toBe(true)
    expect((await getRow(show.id)).slug).toBe('new-name')
  })

  it("refuses a slug another show has, changing nothing", async () => {
    const user = await createUser()
    await insertShow((await createUser()).id, { slug: 'taken' })
    const show = await insertShow(user.id, { title: 'Old', slug: 'mine' })
    await expect(updateShow(user.id, { id: show.id, title: 'New', slug: 'taken' })).rejects.toThrow(ShowSlugError)
    expect(await getRow(show.id)).toMatchObject({ title: 'Old', slug: 'mine' })
  })

  it('keeps its own slug when given it again', async () => {
    const user = await createUser()
    const show = await insertShow(user.id, { slug: 'same' })
    expect(await updateShow(user.id, { id: show.id, title: 'T', slug: 'same' })).toBe(true)
  })

  it("refuses to update another user's show", async () => {
    const show = await insertShow((await createUser()).id, { title: 'Theirs' })
    expect(await updateShow((await createUser()).id, { id: show.id, title: 'Mine now' })).toBe(false)
    expect((await getRow(show.id)).title).toBe('Theirs')
  })

  it('keeps the image when no image change is given', async () => {
    const user = await createUser()
    const image = await storeTestImage()
    const show = await insertShow(user.id, { imageUrl: image.url })
    await updateShow(user.id, { id: show.id, title: 'T' })
    expect((await getRow(show.id)).imageUrl).toBe(image.url)
    expect(await exists(image.path)).toBe(true)
  })

  it('replaces the image with a staged one and deletes the old file', async () => {
    const user = await createUser()
    const old = await storeTestImage()
    const show = await insertShow(user.id, { imageUrl: old.url })
    const imageId = await stageTestImage(user.id)
    await updateShow(user.id, { id: show.id, title: 'T', imageId })
    expect((await getRow(show.id)).imageUrl).toBe(`/images/${imageId}.jpg`)
    expect(await exists(imagePath(imageId))).toBe(true)
    expect(await exists(old.path)).toBe(false)
  })

  it('removes the image when given null', async () => {
    const user = await createUser()
    const old = await storeTestImage()
    const show = await insertShow(user.id, { imageUrl: old.url })
    await updateShow(user.id, { id: show.id, title: 'T', imageId: null })
    expect((await getRow(show.id)).imageUrl).toBeNull()
    expect(await exists(old.path)).toBe(false)
  })

  it('fails without changes when the staged image has expired', async () => {
    const user = await createUser()
    const show = await insertShow(user.id, { title: 'Before' })
    await expect(
      updateShow(user.id, { id: show.id, title: 'After', imageId: crypto.randomUUID() }),
    ).rejects.toThrow('That image has expired')
    expect((await getRow(show.id)).title).toBe('Before')
  })
})

describe('getPublicShow', () => {
  it('finds any show by slug, with its author', async () => {
    const user = await createUser({ name: 'Ada' })
    const show = await insertShow(user.id, { slug: 'show', title: 'Show', category: 'Music' })
    expect(await getPublicShow('show', null)).toEqual({
      id: show.id,
      userId: user.id,
      title: 'Show',
      slug: 'show',
      description: null,
      imageUrl: null,
      category: 'Music',
      explicit: false,
      private: false,
      feedKey: null,
      author: 'Ada',
      ownerSlug: user.slug,
      directoryLinks: {},
      followerCount: 0,
      following: false,
    })
  })

  it("prefers the show's own author to the owner's name", async () => {
    await insertShow((await createUser({ name: 'Ada' })).id, { slug: 'show', author: 'The Show Team' })
    expect(await getPublicShow('show', null)).toMatchObject({ author: 'The Show Team' })
  })

  it('shows private shows only to their owner', async () => {
    const owner = await createUser()
    await insertShow(owner.id, { slug: 'secret', private: true })
    expect(await getPublicShow('secret', owner.id)).toMatchObject({ slug: 'secret', private: true })
    expect(await getPublicShow('secret', null)).toBeNull()
    expect(await getPublicShow('secret', (await createUser()).id)).toBeNull()
  })

  it("doesn't use a private episode's artwork", async () => {
    const show = await insertShow((await createUser()).id, { slug: 'show' })
    await createEpisode(show.id, { status: 'ready', imageUrl: '/images/hidden.jpg', private: true })
    expect((await getPublicShow('show', null))!.imageUrl).toBeNull()
  })

  it("falls back to a ready episode's artwork", async () => {
    const show = await insertShow((await createUser()).id, { slug: 'show' })
    await createEpisode(show.id, { status: 'ready', imageUrl: '/images/ep.jpg' })
    expect((await getPublicShow('show', null))!.imageUrl).toBe('/images/ep.jpg')
  })

  it('returns null for an unknown slug', async () => {
    expect(await getPublicShow('nope', null)).toBeNull()
  })
})

describe('setShowPrivacy', () => {
  it('makes a show private with a feed key, and keeps the key when made public and private again', async () => {
    const user = await createUser()
    const show = await insertShow(user.id)
    expect(await setShowPrivacy(user.id, show.id, true)).toBe(true)
    const { private: isPrivate, feedKey } = await getRow(show.id)
    expect(isPrivate).toBe(true)
    expect(feedKey).toMatch(/^[0-9a-f]{32}$/)

    await setShowPrivacy(user.id, show.id, false)
    expect(await getRow(show.id)).toMatchObject({ private: false, feedKey })
    await setShowPrivacy(user.id, show.id, true)
    expect(await getRow(show.id)).toMatchObject({ private: true, feedKey })
  })

  it("won't change someone else's show", async () => {
    const show = await insertShow((await createUser()).id)
    expect(await setShowPrivacy((await createUser()).id, show.id, true)).toBe(false)
    expect((await getRow(show.id)).private).toBe(false)
  })
})

describe('resetFeedKey', () => {
  it('gives a private show a new key, and only for its owner', async () => {
    const user = await createUser()
    const show = await insertShow(user.id)
    await setShowPrivacy(user.id, show.id, true)
    const before = (await getRow(show.id)).feedKey
    expect(await resetFeedKey((await createUser()).id, show.id)).toBe(false)
    expect((await getRow(show.id)).feedKey).toBe(before)
    expect(await resetFeedKey(user.id, show.id)).toBe(true)
    expect((await getRow(show.id)).feedKey).not.toBe(before)
  })

  it("doesn't reset a public show's", async () => {
    const user = await createUser()
    const show = await insertShow(user.id)
    expect(await resetFeedKey(user.id, show.id)).toBe(false)
  })
})

describe('updateDirectoryDetails', () => {
  const details = {
    category: 'Music' as const,
    subcategory: 'Music History',
    language: 'en-ie' as const,
    explicit: true,
    author: 'The Show Team',
    ownerEmail: 'show@example.com',
  }

  it("saves the details on the user's own show", async () => {
    const user = await createUser()
    const show = await insertShow(user.id)
    expect(await updateDirectoryDetails(user.id, { id: show.id, ...details })).toBe(true)
    expect(await getRow(show.id)).toMatchObject(details)
  })

  it("leaves someone else's show alone", async () => {
    const show = await insertShow((await createUser()).id)
    const other = await createUser()
    expect(await updateDirectoryDetails(other.id, { id: show.id, ...details })).toBe(false)
    expect(await getRow(show.id)).toMatchObject({ category: null, ownerEmail: null })
  })
})

describe('updateDirectoryLink', () => {
  const apple = 'https://podcasts.apple.com/show/id1'
  const spotify = 'https://open.spotify.com/show/abc'

  it('remembers each listing, and forgets one given an empty link', async () => {
    const user = await createUser()
    const show = await insertShow(user.id)
    await updateDirectoryLink(user.id, { id: show.id, directory: 'apple', link: apple })
    await updateDirectoryLink(user.id, { id: show.id, directory: 'spotify', link: spotify })
    expect((await getRow(show.id)).directoryLinks).toEqual({ apple, spotify })
    await updateDirectoryLink(user.id, { id: show.id, directory: 'apple', link: '' })
    expect((await getRow(show.id)).directoryLinks).toEqual({ spotify })
  })

  it("leaves someone else's show alone", async () => {
    const show = await insertShow((await createUser()).id)
    const other = await createUser()
    expect(await updateDirectoryLink(other.id, { id: show.id, directory: 'apple', link: apple })).toBe(false)
    expect((await getRow(show.id)).directoryLinks).toEqual({})
  })
})
