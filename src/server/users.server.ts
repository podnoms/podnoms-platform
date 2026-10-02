// Email/password accounts, stored in the same users table Auth.js uses.
import '@tanstack/react-start/server-only'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { eq, sql } from 'drizzle-orm'
import type { EditProfileInput } from '~/lib/profile-schema'
import { db } from '~/server/db/client.server'
import { users } from '~/server/db/schema'
import { commitImage, deleteImage } from '~/server/images.server'
import { sanitizeDescription } from '~/server/rich-text.server'

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

export type User = { id: string; email: string }

// Stored as "<salt hex>:<hash hex>".
async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

async function checkPassword(password: string, stored: string) {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

const byEmail = (email: string) => sql`lower(${users.email}) = ${email.toLowerCase()}`

// Returns null if the email is already registered, including by an OAuth sign-in.
export async function createUser(email: string, password: string): Promise<User | null> {
  const passwordHash = await hashPassword(password)
  // The unique index on lower(email) turns a taken address into a no-op.
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash })
    .onConflictDoNothing()
    .returning({ id: users.id, email: users.email })
  return user?.email ? { id: user.id, email: user.email } : null
}

export async function verifyUser(email: string, password: string): Promise<User | null> {
  const [user] = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(byEmail(email))
    .limit(1)
  // OAuth-only users have no password hash, so they can't sign in this way.
  if (!user?.email || !user.passwordHash) return null
  if (!(await checkPassword(password, user.passwordHash))) return null
  return { id: user.id, email: user.email }
}

// What the user shows as, and edits on the settings page. Read from the
// database rather than the session, which only has what was true at sign-in.
export async function getProfile(userId: string) {
  const [profile] = await db
    .select({ name: users.name, email: users.email, description: users.description, imageUrl: users.image })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return profile ?? null
}

// Returns false if the user doesn't exist.
export async function updateProfile(userId: string, input: EditProfileInput) {
  const profile = await getProfile(userId)
  if (!profile) return false
  const imageUrl =
    input.imageId === undefined ? profile.imageUrl : input.imageId ? await commitImage(userId, input.imageId) : null
  await db
    .update(users)
    .set({ name: input.name, description: sanitizeDescription(input.description), image: imageUrl })
    .where(eq(users.id, userId))
  if (imageUrl !== profile.imageUrl) await deleteImage(profile.imageUrl)
  return true
}
