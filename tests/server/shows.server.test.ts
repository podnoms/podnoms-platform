import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { themePresets } from '~/lib/theme-presets'
import { pickStyles } from '~/lib/theme-schema'
import { shows } from '~/server/db/schema'
import {
  createShow,
  getShowBySlug,
  getPublicShow,
  listShows,
  movedShow,
  resetFeedKey,
  setShowPrivacy,
  updateDirectoryDetails,
  updateDirectoryLink,
  updateShowTheme,
  ShowSlugError,
  updateShow,
} from '~/server/shows.server'
import { prepareFonts } from '~/server/fonts.server'
import { imagePath } from '~/server/storage.server'
import { updateProfile } from '~/server/users.server'
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

// Saving a theme downloads its fonts from Google; fonts.server.test.ts tests that.
vi.mock('~/server/fonts.server', () => ({ prepareFonts: vi.fn(async () => {}) }))

beforeEach(() => resetDb(db))

async function getRow(id: string) {
  const [row] = await db.select().from(shows).where(eq(shows.id, id))
  return row!
}

describe('createShow', () => {
  it('creates the show with a slug from its title', async () => {
    const user = await createUser()
    const show = await createShow(user.id, { title: 'My Great Show' })
    expect(show).toEqual({ id: expect.any(String), title: 'My Great Show', slug: 'my-great-show', ownerSlug: user.slug, imageUrl: null })
    const row = await getRow(show.id)
    expect(row.userId).toBe(user.id)
    // Made once, for the feed (without SITE_URL, at random).
    expect(row.podcastGuid).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('stores the plain-text description as HTML', async () => {
    const show = await createShow((await createUser()).id, { title: 'T', description: 'One\n\nTwo <b>' })
    expect((await getRow(show.id)).description).toBe('<p>One</p><p>Two &lt;b&gt;</p>')
  })

  it("makes slugs unique among the owner's shows, which can share them with others'", async () => {
    const a = await createUser()
    const b = await createUser()
    expect((await createShow(a.id, { title: 'Show' })).slug).toBe('show')
    expect((await createShow(b.id, { title: 'Show' })).slug).toBe('show')
    expect((await createShow(a.id, { title: 'SHOW!' })).slug).toBe('show-2')
  })

  it("doesn't take one of the owner's shows' old slugs, which redirect", async () => {
    const user = await createUser()
    const show = await insertShow(user.id, { slug: 'show' })
    await updateShow(user.id, { id: show.id, title: 'Show', slug: 'renamed' })
    expect((await createShow(user.id, { title: 'Show' })).slug).toBe('show-2')
  })

  it('falls back to "show" when the title has no usable characters', async () => {
    expect((await createShow((await createUser()).id, { title: '🎙️' })).slug).toBe('show')
  })

  it("doesn't take the name of one of the pages under its owner", async () => {
    const user = await createUser()
    expect((await createShow(user.id, { title: 'Playlists' })).slug).toBe('playlists-2')
    // The site's own top-level pages are fine down here.
    expect((await createShow(user.id, { title: 'Explore' })).slug).toBe('explore')
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

  it("refuses a slug another of the owner's shows has, or had, changing nothing", async () => {
    const user = await createUser()
    await insertShow(user.id, { slug: 'taken' })
    const moved = await insertShow(user.id, { slug: 'was' })
    await updateShow(user.id, { id: moved.id, title: 'T', slug: 'now' })
    const show = await insertShow(user.id, { title: 'Old', slug: 'mine' })
    for (const slug of ['taken', 'was']) {
      await expect(updateShow(user.id, { id: show.id, title: 'New', slug })).rejects.toThrow(ShowSlugError)
    }
    expect(await getRow(show.id)).toMatchObject({ title: 'Old', slug: 'mine' })
  })

  it("takes a slug another owner's show has", async () => {
    const user = await createUser()
    await insertShow((await createUser()).id, { slug: 'taken' })
    const show = await insertShow(user.id, { slug: 'mine' })
    expect(await updateShow(user.id, { id: show.id, title: 'T', slug: 'taken' })).toBe(true)
  })

  it('redirects from the old slug, and can go back to it', async () => {
    const user = await createUser()
    const show = await insertShow(user.id, { slug: 'old' })
    const old = { ownerSlug: user.slug, slug: 'old' }
    expect(await movedShow(old)).toBeNull()
    await updateShow(user.id, { id: show.id, title: 'T', slug: 'new' })
    expect(await movedShow(old)).toEqual({ ownerSlug: user.slug, slug: 'new' })
    await updateShow(user.id, { id: show.id, title: 'T', slug: 'newer' })
    expect(await movedShow(old)).toEqual({ ownerSlug: user.slug, slug: 'newer' })
    expect(await movedShow({ ownerSlug: user.slug, slug: 'new' })).toEqual({ ownerSlug: user.slug, slug: 'newer' })
    await updateShow(user.id, { id: show.id, title: 'T', slug: 'old' })
    expect(await movedShow(old)).toBeNull()
    expect(await movedShow({ ownerSlug: user.slug, slug: 'newer' })).toEqual(old)
    // Another owner's slug of the same name is nothing to do with it.
    expect(await movedShow({ ownerSlug: (await createUser()).slug, slug: 'new' })).toBeNull()
  })

  it("follows its owner's new slug", async () => {
    const user = await createUser({ slug: 'ada' })
    await insertShow(user.id, { slug: 'show' })
    expect(await updateProfile(user.id, { name: null, slug: 'ada-l' })).toBe(true)
    expect(await movedShow({ ownerSlug: 'ada', slug: 'show' })).toEqual({ ownerSlug: 'ada-l', slug: 'show' })
    expect(await movedShow({ ownerSlug: 'ada-l', slug: 'show' })).toBeNull()
    expect(await movedShow({ ownerSlug: 'ada', slug: 'nope' })).toBeNull()
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
    expect(await getPublicShow({ ownerSlug: user.slug, slug: 'show' }, null)).toEqual({
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
      theme: null,
      followerCount: 0,
      following: false,
    })
  })

  it("prefers the show's own author to the owner's name", async () => {
    const show = await insertShow((await createUser({ name: 'Ada' })).id, { slug: 'show', author: 'The Show Team' })
    expect(await getPublicShow({ id: show.id }, null)).toMatchObject({ author: 'The Show Team' })
  })

  it('shows private shows only to their owner', async () => {
    const owner = await createUser()
    const secret = { ownerSlug: owner.slug, slug: 'secret' }
    await insertShow(owner.id, { slug: 'secret', private: true })
    expect(await getPublicShow(secret, owner.id)).toMatchObject({ slug: 'secret', private: true })
    expect(await getPublicShow(secret, null)).toBeNull()
    expect(await getPublicShow(secret, (await createUser()).id)).toBeNull()
  })

  it("doesn't use a private episode's artwork", async () => {
    const show = await insertShow((await createUser()).id, { slug: 'show' })
    await createEpisode(show.id, { status: 'ready', imageUrl: '/images/hidden.jpg', private: true })
    expect((await getPublicShow({ id: show.id }, null))!.imageUrl).toBeNull()
  })

  it("falls back to a ready episode's artwork", async () => {
    const show = await insertShow((await createUser()).id, { slug: 'show' })
    await createEpisode(show.id, { status: 'ready', imageUrl: '/images/ep.jpg' })
    expect((await getPublicShow({ id: show.id }, null))!.imageUrl).toBe('/images/ep.jpg')
  })

  it('returns null for an unknown address', async () => {
    const user = await createUser()
    await insertShow(user.id, { slug: 'show' })
    expect(await getPublicShow({ ownerSlug: user.slug, slug: 'nope' }, null)).toBeNull()
    // Show slugs are only unique per owner.
    expect(await getPublicShow({ ownerSlug: (await createUser()).slug, slug: 'show' }, null)).toBeNull()
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

describe('updateShowTheme', () => {
  const { light, dark } = themePresets['modern-minimal']!.styles
  const theme = { basedOn: 'modern-minimal', styles: { light: pickStyles(light), dark: pickStyles(dark) } }

  it("gives the user's own show a theme, for its public pages, and takes it away", async () => {
    const user = await createUser()
    const show = await insertShow(user.id, { slug: 'show' })
    const withSpacing = { ...theme, styles: { ...theme.styles, light: { ...theme.styles.light, spacing: '0.3rem' } } }
    expect(await updateShowTheme(user.id, { id: show.id, theme: withSpacing })).toBe(true)
    // Only the values the site uses are kept, and its fonts are downloaded first.
    expect((await getRow(show.id)).theme).toEqual(theme)
    expect(prepareFonts).toHaveBeenCalledWith(['Inter', 'Source Serif 4', 'JetBrains Mono'])
    expect(await getPublicShow({ id: show.id }, null)).toMatchObject({ theme })
    expect(await updateShowTheme(user.id, { id: show.id, theme: null })).toBe(true)
    expect((await getRow(show.id)).theme).toBeNull()
  })

  it("leaves someone else's show alone", async () => {
    const show = await insertShow((await createUser()).id)
    expect(await updateShowTheme((await createUser()).id, { id: show.id, theme })).toBe(false)
    expect((await getRow(show.id)).theme).toBeNull()
  })
})
