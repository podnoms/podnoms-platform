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

// For the isAdmin column of a new user: the first user to sign up becomes an
// admin, however they sign up (see also the OAuth adapter in auth.server.ts).
export const firstUserIsAdmin = sql<boolean>`not exists (select 1 from ${users})`

// Returns null if the email is already registered, including by an OAuth sign-in.
export async function createUser(email: string, password: string): Promise<User | null> {
  const passwordHash = await hashPassword(password)
  // The unique index on lower(email) turns a taken address into a no-op.
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, isAdmin: firstUserIsAdmin })
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

export async function hasPassword(userId: string) {
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1)
  return Boolean(user?.passwordHash)
}

// Adds a password to an account (one made with OAuth, say) or changes it, which
// needs the current one. Being signed in is proof enough to add the first one.
export async function setPassword(userId: string, password: string, currentPassword?: string) {
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return { ok: false as const, error: 'You need to be signed in' }
  if (user.passwordHash && !(currentPassword && (await checkPassword(currentPassword, user.passwordHash)))) {
    return { ok: false as const, error: 'Your current password is wrong' }
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, userId))
  return { ok: true as const }
}

// What the user shows as, and edits on the settings page. Read from the
// database rather than the session, which only has what was true at sign-in.
export async function getProfile(userId: string) {
  const [profile] = await db
    .select({
      name: users.name,
      email: users.email,
      description: users.description,
      imageUrl: users.image,
      isAdmin: users.isAdmin,
    })
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

export async function isAdmin(userId: string) {
  const [user] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId)).limit(1)
  return user?.isAdmin ?? false
}

// How many of a channel's newest uploads the user's podcasts import (see
// channels.server.ts); 0 if there's no such user.
export async function getChannelEpisodeLimit(userId: string) {
  const [user] = await db
    .select({ limit: users.channelEpisodeLimit })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return user?.limit ?? 0
}
