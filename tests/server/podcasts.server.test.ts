import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { podcasts } from '~/server/db/schema'
import { createPodcast, getPodcastBySlug, getPublicPodcast, listPodcasts, updatePodcast } from '~/server/podcasts.server'
import { imagePath } from '~/server/storage.server'
import { resetDb } from '../db'
import {
  createEpisode,
  createPodcast as insertPodcast,
  createUser,
  db,
  exists,
  stageTestImage,
  storeTestImage,
} from '../helpers'

beforeEach(() => resetDb(db))

async function getRow(id: string) {
  const [row] = await db.select().from(podcasts).where(eq(podcasts.id, id))
  return row!
}

describe('createPodcast', () => {
  it('creates the podcast with a slug from its title', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { title: 'My Great Show' })
    expect(podcast).toEqual({ id: expect.any(String), title: 'My Great Show', slug: 'my-great-show', imageUrl: null })
    expect((await getRow(podcast.id)).userId).toBe(user.id)
  })

  it('stores the plain-text description as HTML', async () => {
    const podcast = await createPodcast((await createUser()).id, { title: 'T', description: 'One\n\nTwo <b>' })
    expect((await getRow(podcast.id)).description).toBe('<p>One</p><p>Two &lt;b&gt;</p>')
  })

  it('makes slugs unique across all users', async () => {
    const a = await createUser()
    const b = await createUser()
    expect((await createPodcast(a.id, { title: 'Show' })).slug).toBe('show')
    expect((await createPodcast(b.id, { title: 'Show' })).slug).toBe('show-2')
    expect((await createPodcast(a.id, { title: 'SHOW!' })).slug).toBe('show-3')
  })

  it('falls back to "podcast" when the title has no usable characters', async () => {
    expect((await createPodcast((await createUser()).id, { title: '🎙️' })).slug).toBe('podcast')
  })
})

describe('listPodcasts', () => {
  it("lists only the user's podcasts, by title", async () => {
    const user = await createUser()
    await insertPodcast(user.id, { title: 'Zebra' })
    await insertPodcast(user.id, { title: 'Aardvark' })
    await insertPodcast((await createUser()).id, { title: 'Not mine' })
    expect((await listPodcasts(user.id)).map((p) => p.title)).toEqual(['Aardvark', 'Zebra'])
  })

  it("uses the newest ready episode's artwork when the podcast has none", async () => {
    const user = await createUser()
    const podcast = await insertPodcast(user.id)
    await createEpisode(podcast.id, { status: 'ready', imageUrl: '/images/old.jpg', createdAt: new Date('2026-01-01') })
    await createEpisode(podcast.id, { status: 'ready', imageUrl: '/images/new.jpg', createdAt: new Date('2026-02-01') })
    await createEpisode(podcast.id, { status: 'failed', imageUrl: '/images/failed.jpg', createdAt: new Date('2026-03-01') })
    expect((await listPodcasts(user.id))[0]!.imageUrl).toBe('/images/new.jpg')
  })

  it('says when each was made and when its latest ready episode came out', async () => {
    const user = await createUser()
    const quiet = await insertPodcast(user.id, { title: 'Quiet', createdAt: new Date('2026-03-01') })
    const busy = await insertPodcast(user.id, { title: 'Busy', createdAt: new Date('2026-01-01') })
    await createEpisode(busy.id, { status: 'ready', publishedAt: new Date('2026-02-01') })
    await createEpisode(busy.id, { status: 'ready', createdAt: new Date('2026-04-01') })
    await createEpisode(busy.id, { status: 'failed', createdAt: new Date('2026-05-01') })
    await createEpisode(quiet.id, { status: 'pending', createdAt: new Date('2026-06-01') })

    expect(await listPodcasts(user.id)).toMatchObject([
      { title: 'Busy', createdAt: new Date('2026-01-01'), latestEpisodeAt: new Date('2026-04-01') },
      { title: 'Quiet', createdAt: new Date('2026-03-01'), latestEpisodeAt: null },
    ])
  })

  it("prefers the podcast's own artwork", async () => {
    const user = await createUser()
    const podcast = await insertPodcast(user.id, { imageUrl: '/images/own.jpg' })
    await createEpisode(podcast.id, { status: 'ready', imageUrl: '/images/episode.jpg' })
    expect((await listPodcasts(user.id))[0]!.imageUrl).toBe('/images/own.jpg')
  })
})

describe('getPodcastBySlug', () => {
  it("finds the user's podcast and nobody else's", async () => {
    const owner = await createUser()
    const podcast = await insertPodcast(owner.id, { slug: 'mine' })
    expect((await getPodcastBySlug(owner.id, 'mine'))?.id).toBe(podcast.id)
    expect(await getPodcastBySlug((await createUser()).id, 'mine')).toBeNull()
    expect(await getPodcastBySlug(owner.id, 'missing')).toBeNull()
  })
})

describe('updatePodcast', () => {
  it('updates the title and sanitised description, keeping the slug', async () => {
    const user = await createUser()
    const podcast = await insertPodcast(user.id, { title: 'Old', slug: 'old' })
    const ok = await updatePodcast(user.id, {
      id: podcast.id,
      title: 'New',
      description: '<p>Hi<script>x</script></p>',
    })
    expect(ok).toBe(true)
    const row = await getRow(podcast.id)
    expect(row).toMatchObject({ title: 'New', slug: 'old', description: '<p>Hi</p>' })
  })

  it("refuses to update another user's podcast", async () => {
    const podcast = await insertPodcast((await createUser()).id, { title: 'Theirs' })
    expect(await updatePodcast((await createUser()).id, { id: podcast.id, title: 'Mine now' })).toBe(false)
    expect((await getRow(podcast.id)).title).toBe('Theirs')
  })

  it('keeps the image when no image change is given', async () => {
    const user = await createUser()
    const image = await storeTestImage()
    const podcast = await insertPodcast(user.id, { imageUrl: image.url })
    await updatePodcast(user.id, { id: podcast.id, title: 'T' })
    expect((await getRow(podcast.id)).imageUrl).toBe(image.url)
    expect(await exists(image.path)).toBe(true)
  })

  it('replaces the image with a staged one and deletes the old file', async () => {
    const user = await createUser()
    const old = await storeTestImage()
    const podcast = await insertPodcast(user.id, { imageUrl: old.url })
    const imageId = await stageTestImage(user.id)
    await updatePodcast(user.id, { id: podcast.id, title: 'T', imageId })
    expect((await getRow(podcast.id)).imageUrl).toBe(`/images/${imageId}.jpg`)
    expect(await exists(imagePath(imageId))).toBe(true)
    expect(await exists(old.path)).toBe(false)
  })

  it('removes the image when given null', async () => {
    const user = await createUser()
    const old = await storeTestImage()
    const podcast = await insertPodcast(user.id, { imageUrl: old.url })
    await updatePodcast(user.id, { id: podcast.id, title: 'T', imageId: null })
    expect((await getRow(podcast.id)).imageUrl).toBeNull()
    expect(await exists(old.path)).toBe(false)
  })

  it('fails without changes when the staged image has expired', async () => {
    const user = await createUser()
    const podcast = await insertPodcast(user.id, { title: 'Before' })
    await expect(
      updatePodcast(user.id, { id: podcast.id, title: 'After', imageId: crypto.randomUUID() }),
    ).rejects.toThrow('That image has expired')
    expect((await getRow(podcast.id)).title).toBe('Before')
  })
})

describe('getPublicPodcast', () => {
  it('finds any podcast by slug, with its author', async () => {
    const user = await createUser({ name: 'Ada' })
    const podcast = await insertPodcast(user.id, { slug: 'show', title: 'Show', category: 'Music' })
    expect(await getPublicPodcast('show')).toEqual({
      id: podcast.id,
      userId: user.id,
      title: 'Show',
      slug: 'show',
      description: null,
      imageUrl: null,
      category: 'Music',
      explicit: false,
      private: false,
      author: 'Ada',
    })
  })

  it('includes private podcasts, which are unlisted rather than secret', async () => {
    await insertPodcast((await createUser()).id, { slug: 'secret', private: true })
    expect(await getPublicPodcast('secret')).toMatchObject({ slug: 'secret', private: true })
  })

  it("falls back to a ready episode's artwork", async () => {
    const podcast = await insertPodcast((await createUser()).id, { slug: 'show' })
    await createEpisode(podcast.id, { status: 'ready', imageUrl: '/images/ep.jpg' })
    expect((await getPublicPodcast('show'))!.imageUrl).toBe('/images/ep.jpg')
  })

  it('returns null for an unknown slug', async () => {
    expect(await getPublicPodcast('nope')).toBeNull()
  })
})
