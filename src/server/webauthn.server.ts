// Security keys (YubiKeys and the like) as a second factor, via WebAuthn.
// They're registered as plain second factors, not passkeys: the key needn't
// store the account or check a PIN, a touch is enough.
import '@tanstack/react-start/server-only'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { securityKeys, users } from '~/server/db/schema'
import { ExpiringStore } from '~/server/expiring-store.server'

// The challenge each user was last sent, keyed by "<ceremony>:<user id>".
const challenges = new ExpiringStore<string>(5 * 60_000)

// Keys are bound to the host they were registered on, so `url` must be the
// app's public URL (see publicUrl in site-url.server.ts).
const relyingParty = (url: URL) => ({ rpID: url.hostname, origin: url.origin })

const userKeys = (userId: string) =>
  db
    .select({ id: securityKeys.id, transports: securityKeys.transports })
    .from(securityKeys)
    .where(eq(securityKeys.userId, userId))

// No extensions are requested, so options are returned without the field,
// whose type includes values that can't be sent from a server function.
function withoutExtensions<T extends { extensions?: unknown }>({ extensions: _, ...options }: T) {
  return options
}

const descriptor = (key: { id: string; transports: string[] | null }) => ({
  id: key.id,
  transports: key.transports ?? undefined,
})

export async function startKeyRegistration(userId: string, url: URL) {
  const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId))
  const options = await generateRegistrationOptions({
    rpName: 'podnoms',
    rpID: relyingParty(url).rpID,
    userName: user?.email ?? user?.name ?? userId,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    // Stops the same key being registered twice.
    excludeCredentials: (await userKeys(userId)).map(descriptor),
    authenticatorSelection: { residentKey: 'discouraged', userVerification: 'discouraged' },
  })
  challenges.set(`register:${userId}`, options.challenge)
  return withoutExtensions(options)
}

// Returns false if the response doesn't check out or the key is already registered.
export async function finishKeyRegistration(
  userId: string,
  name: string,
  response: RegistrationResponseJSON,
  url: URL,
) {
  const expectedChallenge = challenges.take(`register:${userId}`)
  if (!expectedChallenge) return false
  const { rpID, origin } = relyingParty(url)
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  }).catch(() => null)
  if (!verification?.verified) return false

  const { credential } = verification.registrationInfo
  const inserted = await db
    .insert(securityKeys)
    .values({
      id: credential.id,
      userId,
      name,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: securityKeys.id })
  return inserted.length > 0
}

// Options for asking the browser to sign with one of the user's keys, or null
// if they have none.
export async function startKeyAuthentication(userId: string, url: URL) {
  const keys = await userKeys(userId)
  if (keys.length === 0) return null
  const options = await generateAuthenticationOptions({
    rpID: relyingParty(url).rpID,
    allowCredentials: keys.map(descriptor),
    userVerification: 'discouraged',
  })
  challenges.set(`authenticate:${userId}`, options.challenge)
  return withoutExtensions(options)
}

export async function verifyKeyAuthentication(userId: string, response: AuthenticationResponseJSON, url: URL) {
  const expectedChallenge = challenges.take(`authenticate:${userId}`)
  if (!expectedChallenge) return false
  const [key] = await db
    .select()
    .from(securityKeys)
    .where(and(eq(securityKeys.id, response.id), eq(securityKeys.userId, userId)))
  if (!key) return false

  const { rpID, origin } = relyingParty(url)
  // Also fails if the counter went backwards, a sign the key was cloned.
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: key.id,
      publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')),
      counter: key.counter,
      transports: key.transports ?? undefined,
    },
    requireUserVerification: false,
  }).catch(() => null)
  if (!verification?.verified) return false

  await db
    .update(securityKeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(securityKeys.id, key.id))
  return true
}
