import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { users } from '~/server/db/schema'
import { createUser, verifyUser } from '~/server/users.server'
import { resetDb } from '../db'
import { createUser as insertUser, db } from '../helpers'

beforeEach(() => resetDb(db))

describe('createUser', () => {
  it('stores a salted scrypt hash, never the password', async () => {
    const user = await createUser('a@example.com', 'password123')
    expect(user).toEqual({ id: expect.any(String), email: 'a@example.com' })
    const [row] = await db.select().from(users).where(eq(users.id, user!.id))
    expect(row!.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)
    expect(row!.passwordHash).not.toContain('password123')
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
