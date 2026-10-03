import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { users } from '~/server/db/schema'
import { imagePath } from '~/server/storage.server'
import { createUser, getProfile, isAdmin, updateProfile, verifyUser } from '~/server/users.server'
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
