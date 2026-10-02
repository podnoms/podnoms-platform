// Two-factor authentication. A user has it on while they have an
// authenticator app (TOTP) or at least one security key (webauthn.server.ts);
// recovery codes are a fallback for losing those.
//
// Signing in with 2FA on gives a session marked as pending (see the jwt
// callback in auth.server.ts). Passing a second factor here issues a one-time
// ticket, which the browser hands to Auth.js to clear the mark.
import '@tanstack/react-start/server-only'
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { and, asc, count, eq, isNull, lt, or } from 'drizzle-orm'
import { Secret, TOTP } from 'otpauth'
import QRCode from 'qrcode'
import { env } from '~/env'
import { db } from '~/server/db/client.server'
import { recoveryCodes, securityKeys, users } from '~/server/db/schema'
import { ExpiringStore } from '~/server/expiring-store.server'
import { verifyKeyAuthentication } from '~/server/webauthn.server'

// --- Authenticator app secrets ----------------------------------------------

// Secrets are encrypted with a key derived from AUTH_SECRET, so a copy of the
// database alone can't generate codes. Changing AUTH_SECRET means everyone
// has to set up their authenticator app again.
const encryptionKey = Buffer.from(hkdfSync('sha256', env.AUTH_SECRET, '', 'podnoms totp secret', 32))

// Stored as "<iv>.<auth tag>.<ciphertext>", each base64url-encoded.
function encrypt(plaintext: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

function decrypt(stored: string) {
  const [iv, tag, ciphertext] = stored.split('.').map((part) => Buffer.from(part, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv!)
  decipher.setAuthTag(tag!)
  return Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString('utf8')
}

const periodSeconds = 30

const totp = (secret: string, label = 'podnoms') =>
  new TOTP({ issuer: 'podnoms', label, secret: Secret.fromBase32(secret), period: periodSeconds })

// The time step a code belongs to, allowing one step of clock drift either
// way, or null if it isn't valid for the secret.
function codeStep(secret: string, code: string, now = Date.now()) {
  const delta = totp(secret).validate({ token: code, timestamp: now, window: 1 })
  return delta === null ? null : Math.floor(now / 1000 / periodSeconds) + delta
}

// Secrets shown to users who are setting up an app, until they confirm a code.
const pendingSecrets = new ExpiringStore<string>(15 * 60_000)

export async function startTotpSetup(userId: string) {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId))
  const secret = new Secret({ size: 20 }).base32
  pendingSecrets.set(userId, secret)
  const uri = totp(secret, user?.email ?? 'podnoms').toString()
  return { secret, uri, qrCode: await QRCode.toDataURL(uri, { margin: 1, width: 200 }) }
}

// Turns the app on once the user proves it's generating the right codes.
export async function confirmTotpSetup(userId: string, code: string) {
  const secret = pendingSecrets.get(userId)
  if (!secret) return { ok: false as const, error: 'Setup timed out. Please start again.' }
  const step = codeStep(secret, code)
  if (step === null) return { ok: false as const, error: "That code isn't right. Check your app and try again." }
  await db.update(users).set({ totpSecret: encrypt(secret), totpLastStep: step }).where(eq(users.id, userId))
  pendingSecrets.delete(userId)
  return { ok: true as const, recoveryCodes: await ensureRecoveryCodes(userId) }
}

export async function disableTotp(userId: string) {
  await db.update(users).set({ totpSecret: null, totpLastStep: null }).where(eq(users.id, userId))
  await clearRecoveryCodesIfOff(userId)
}

async function verifyTotp(userId: string, code: string) {
  const [user] = await db
    .select({ secret: users.totpSecret, lastStep: users.totpLastStep })
    .from(users)
    .where(eq(users.id, userId))
  if (!user?.secret) return false
  const step = codeStep(decrypt(user.secret), code)
  if (step === null || (user.lastStep !== null && step <= user.lastStep)) return false
  // Only moves forwards, so a code can't be reused even by concurrent requests.
  const updated = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id })
  return updated.length > 0
}

// --- Security keys ------------------------------------------------------------

export async function removeSecurityKey(userId: string, keyId: string) {
  await db.delete(securityKeys).where(and(eq(securityKeys.id, keyId), eq(securityKeys.userId, userId)))
  await clearRecoveryCodesIfOff(userId)
}

// --- Recovery codes -----------------------------------------------------------

const recoveryCodeCount = 10
// Base32, so each random byte maps to a character without bias.
const recoveryAlphabet = 'abcdefghijklmnopqrstuvwxyz234567'

// Ten characters (50 bits), shown as "xxxxx-xxxxx".
function newRecoveryCode() {
  const chars = [...randomBytes(10)].map((byte) => recoveryAlphabet[byte & 31]).join('')
  return `${chars.slice(0, 5)}-${chars.slice(5)}`
}

// Codes are random enough that a plain hash is safe; case and dashes are ignored.
const hashRecoveryCode = (code: string) =>
  createHash('sha256')
    .update(code.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .digest('hex')

// Replaces the user's recovery codes with a new set, returned for showing once.
export async function regenerateRecoveryCodes(userId: string) {
  const codes = Array.from({ length: recoveryCodeCount }, newRecoveryCode)
  await db.transaction(async (tx) => {
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
    await tx.insert(recoveryCodes).values(codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })))
  })
  return codes
}

// Gives the user recovery codes when they turn on 2FA (or have used them all),
// returning them; null if they still have some.
export async function ensureRecoveryCodes(userId: string) {
  return (await unusedRecoveryCodes(userId)) > 0 ? null : regenerateRecoveryCodes(userId)
}

async function unusedRecoveryCodes(userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))
  return row?.n ?? 0
}

async function useRecoveryCode(userId: string, code: string) {
  const used = await db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, hashRecoveryCode(code)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ userId: recoveryCodes.userId })
  return used.length > 0
}

// Recovery codes are pointless once the last second factor is removed.
async function clearRecoveryCodesIfOff(userId: string) {
  if (!(await hasTwoFactor(userId))) await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId))
}

// --- Status -------------------------------------------------------------------

// Which second factors the user can sign in with.
export async function getTwoFactorMethods(userId: string) {
  const [[user], [keys]] = await Promise.all([
    db.select({ totpSecret: users.totpSecret }).from(users).where(eq(users.id, userId)),
    db.select({ n: count() }).from(securityKeys).where(eq(securityKeys.userId, userId)),
  ])
  return { totp: Boolean(user?.totpSecret), securityKey: (keys?.n ?? 0) > 0 }
}

export async function hasTwoFactor(userId: string) {
  const methods = await getTwoFactorMethods(userId)
  return methods.totp || methods.securityKey
}

// For the security settings page.
export async function getTwoFactorStatus(userId: string) {
  const [methods, keys, recoveryCodesLeft] = await Promise.all([
    getTwoFactorMethods(userId),
    db
      .select({
        id: securityKeys.id,
        name: securityKeys.name,
        createdAt: securityKeys.createdAt,
        lastUsedAt: securityKeys.lastUsedAt,
      })
      .from(securityKeys)
      .where(eq(securityKeys.userId, userId))
      .orderBy(asc(securityKeys.createdAt)),
    unusedRecoveryCodes(userId),
  ])
  return { enabled: methods.totp || methods.securityKey, totp: methods.totp, securityKeys: keys, recoveryCodesLeft }
}

// --- Signing in -----------------------------------------------------------------

export type SecondFactor =
  | { method: 'totp'; code: string }
  | { method: 'recovery'; code: string }
  | { method: 'securityKey'; response: AuthenticationResponseJSON }

// After this many wrong attempts, a user can't try again until no attempt has
// been made for the lockout period. Six-digit codes are otherwise guessable.
export const maxFailedAttempts = 5
const failedAttempts = new ExpiringStore<number>(15 * 60_000)

// One-time tickets proving a user passed their second factor, mapped to the user.
const tickets = new ExpiringStore<string>(2 * 60_000)

// Checks a second factor for a user whose session is pending, returning a
// ticket for clearing the pending mark (see redeemTwoFactorTicket).
export async function verifySecondFactor(userId: string, factor: SecondFactor, url: URL) {
  const failures = failedAttempts.get(userId) ?? 0
  if (failures >= maxFailedAttempts) {
    failedAttempts.set(userId, failures)
    return { ok: false as const, error: 'Too many failed attempts. Please wait 15 minutes and try again.' }
  }

  const passed =
    factor.method === 'totp'
      ? await verifyTotp(userId, factor.code)
      : factor.method === 'recovery'
        ? await useRecoveryCode(userId, factor.code)
        : await verifyKeyAuthentication(userId, factor.response, url)
  if (!passed) {
    failedAttempts.set(userId, failures + 1)
    const errors = {
      totp: "That code isn't right. Check your app and try again.",
      recovery: "That recovery code isn't right, or has already been used.",
      securityKey: "That security key couldn't be verified.",
    }
    return { ok: false as const, error: errors[factor.method] }
  }

  failedAttempts.delete(userId)
  const ticket = randomBytes(32).toString('base64url')
  tickets.set(ticket, userId)
  return { ok: true as const, ticket }
}

// Whether `ticket` was issued to this user; each ticket works once.
export function redeemTwoFactorTicket(ticket: unknown, userId: string) {
  return typeof ticket === 'string' && tickets.take(ticket) === userId
}
