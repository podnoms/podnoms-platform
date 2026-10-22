import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { users } from '~/server/db/schema'
import { imagePath } from '~/server/storage.server'
import {
  assignUserSlug,
  createUser,
  getProfile,
  getPublicProfile,
  hasPassword,
  isAdmin,
  searchUsers,
  setPassword,
  updateProfile,
  verifyUser,
} from '~/server/users.server'
import { resetDb } from '../db'
import { createUser as insertUser, db, exists, stageTestImage, storeTestImage } from '../helpers'

beforeEach(() => resetDb(db))

describe('createUser', () => {
  it('stores a salted scrypt hash, never the password', async () => {
    const user = await createUser('a@example.com', 'password123')
    expect(user).toEqual({ id: expect.any(String), email: 'a@example.com' })
    const [row] = await db.select().from(users).where(eq(users.id, user!.id))
    expect(row!.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)
    expect(row!.passwordHash).not.toContain('password123')
  })

  it('makes the first user an admin, and nobody after', async () => {
    const first = await createUser('a@example.com', 'password123')
    const second = await createUser('b@example.com', 'password123')
    expect(await isAdmin(first!.id)).toBe(true)
    expect(await isAdmin(second!.id)).toBe(false)
  })

  it("doesn't make a new user an admin when someone has already signed up with OAuth", async () => {
    await insertUser()
    expect(await isAdmin((await createUser('a@example.com', 'password123'))!.id)).toBe(false)
  })

  it('salts each hash differently', async () => {
    await createUser('a@example.com', 'password123')
    await createUser('b@example.com', 'password123')
    const rows = await db.select({ hash: users.passwordHash }).from(users)
    expect(rows[0]!.hash).not.toBe(rows[1]!.hash)
  })

  it('returns null for an email that is already registered, in any case', async () => {
    await createUser('a@example.com', 'password123')
    expect(await createUser('a@example.com', 'other-password')).toBeNull()
    expect(await createUser('A@Example.com', 'other-password')).toBeNull()
  })

  it('returns null when an OAuth user already has the email', async () => {
    await insertUser({ email: 'oauth@example.com' })
    expect(await createUser('oauth@example.com', 'password123')).toBeNull()
  })
})

describe('setPassword', () => {
  it('adds a password to an OAuth-only user without asking for a current one', async () => {
    const user = await insertUser({ email: 'oauth@example.com' })
    expect(await hasPassword(user.id)).toBe(false)
    expect(await setPassword(user.id, 'new-password')).toEqual({ ok: true })
    expect(await hasPassword(user.id)).toBe(true)
    expect(await verifyUser('oauth@example.com', 'new-password')).toEqual({ id: user.id, email: 'oauth@example.com' })
  })

  it('changes a password given the current one', async () => {
    const user = await createUser('a@example.com', 'password123')
    expect(await setPassword(user!.id, 'new-password', 'password123')).toEqual({ ok: true })
    expect(await verifyUser('a@example.com', 'new-password')).toEqual(user)
    expect(await verifyUser('a@example.com', 'password123')).toBeNull()
  })

  it('refuses to change a password without the right current one', async () => {
    const user = await createUser('a@example.com', 'password123')
    expect(await setPassword(user!.id, 'new-password')).toEqual({ ok: false, error: expect.any(String) })
    expect(await setPassword(user!.id, 'new-password', 'wrong-password')).toEqual({
      ok: false,
      error: expect.any(String),
    })
    expect(await verifyUser('a@example.com', 'password123')).toEqual(user)
  })

  it("refuses a user that doesn't exist", async () => {
    expect((await setPassword(crypto.randomUUID(), 'new-password')).ok).toBe(false)
  })
})

describe('verifyUser', () => {
  it('accepts the right password, matching the email case-insensitively', async () => {
    const user = await createUser('a@example.com', 'password123')
    expect(await verifyUser('a@example.com', 'password123')).toEqual(user)
    expect(await verifyUser('A@EXAMPLE.COM', 'password123')).toEqual(user)
  })

  it('rejects a wrong password or unknown email', async () => {
    await createUser('a@example.com', 'password123')
    expect(await verifyUser('a@example.com', 'password124')).toBeNull()
    expect(await verifyUser('nobody@example.com', 'password123')).toBeNull()
  })

  it('rejects users without a password, such as OAuth users', async () => {
    await insertUser({ email: 'oauth@example.com' })
    expect(await verifyUser('oauth@example.com', 'password123')).toBeNull()
  })

  it('rejects malformed stored hashes', async () => {
    await insertUser({ email: 'broken@example.com', passwordHash: 'not-a-hash' })
    expect(await verifyUser('broken@example.com', 'password123')).toBeNull()
  })
})

describe('getProfile', () => {
  it("returns the user's details", async () => {
    const user = await insertUser({ name: 'Ann', email: 'ann@example.com', image: 'https://example.com/a.png' })
    expect(await getProfile(user.id)).toEqual({
      name: 'Ann',
      slug: user.slug,
      email: 'ann@example.com',
      description: null,
      imageUrl: 'https://example.com/a.png',
      isAdmin: false,
    })
  })

  it('returns null for an unknown user', async () => {
    expect(await getProfile('nobody')).toBeNull()
  })
})

describe('updateProfile', () => {
  it('updates the name and sanitised description, keeping the image', async () => {
    const user = await insertUser({ image: 'https://example.com/a.png' })
    expect(await updateProfile(user.id, { name: 'Bob', description: '<p>Hi<script>x</script></p>' })).toBe(true)
    expect(await getProfile(user.id)).toMatchObject({
      name: 'Bob',
      description: '<p>Hi</p>',
      imageUrl: 'https://example.com/a.png',
    })
  })

  it('clears the name and an empty description', async () => {
    const user = await insertUser({ name: 'Ann', description: '<p>Old</p>' })
    await updateProfile(user.id, { name: null, description: '<p></p>' })
    expect(await getProfile(user.id)).toMatchObject({ name: null, description: null })
  })

  it('stores a new avatar and deletes the old one', async () => {
    const user = await insertUser()
    const old = await storeTestImage()
    await db.update(users).set({ image: old.url }).where(eq(users.id, user.id))
    const imageId = await stageTestImage(user.id)
    await updateProfile(user.id, { name: null, imageId })
    expect((await getProfile(user.id))!.imageUrl).toBe(`/images/${imageId}.jpg`)
    expect(await exists(imagePath(imageId))).toBe(true)
    expect(await exists(old.path)).toBe(false)
  })

  it('removes the avatar', async () => {
    const user = await insertUser()
    const old = await storeTestImage()
    await db.update(users).set({ image: old.url }).where(eq(users.id, user.id))
    await updateProfile(user.id, { name: null, imageId: null })
    expect((await getProfile(user.id))!.imageUrl).toBeNull()
    expect(await exists(old.path)).toBe(false)
  })

  it('returns false for an unknown user', async () => {
    expect(await updateProfile('nobody', { name: 'X' })).toBe(false)
  })
})

describe('user slugs', () => {
  const slugOf = async (id: string) => (await db.select({ slug: users.slug }).from(users).where(eq(users.id, id)))[0]!.slug

  it("gives someone who signs up a slug from their email, the first that's free", async () => {
    await insertUser({ slug: 'ann' })
    const user = await createUser('Ann@example.com', 'correct horse battery')
    expect(await slugOf(user!.id)).toBe('ann-2')
  })

  it('makes one from a name, steering clear of reserved ones', async () => {
    const first = await insertUser()
    await assignUserSlug(first.id, 'Fergal Moran!')
    expect(await slugOf(first.id)).toBe('fergal-moran')
    const second = await insertUser()
    await assignUserSlug(second.id, 'Admin')
    expect(await slugOf(second.id)).toBe('admin-2')
    const third = await insertUser()
    await assignUserSlug(third.id, '✨')
    expect(await slugOf(third.id)).toBe('user')
  })

  it("lets a user change theirs, unless someone has it", async () => {
    await insertUser({ slug: 'taken' })
    const user = await insertUser({ slug: 'mine' })
    expect(await updateProfile(user.id, { name: null, slug: 'taken' })).toBe('slug-taken')
    expect(await slugOf(user.id)).toBe('mine')
    expect(await updateProfile(user.id, { name: null, slug: 'new-one' })).toBe(true)
    expect(await slugOf(user.id)).toBe('new-one')
  })

  it('finds users to mention by the start of their slug, then by name', async () => {
    await insertUser({ slug: 'bob', name: 'Annie Bobbins' })
    await insertUser({ slug: 'ann', name: 'Ann' })
    await insertUser({ slug: 'annette', name: null })
    await insertUser({ slug: 'zed', name: 'Zed' })
    expect((await searchUsers('ann')).map((user) => user.slug)).toEqual(['ann', 'annette', 'bob'])
    expect(await searchUsers('%')).toEqual([])
  })

  it('shows a public profile by slug, whatever its case', async () => {
    const user = await insertUser({ slug: 'ann', name: 'Ann', description: '<p>Hi</p>' })
    expect(await getPublicProfile('ANN')).toEqual({ id: user.id, slug: 'ann', name: 'Ann', image: null, description: '<p>Hi</p>' })
    expect(await getPublicProfile('nobody')).toBeNull()
  })
})
