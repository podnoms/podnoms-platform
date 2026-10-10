// "Forgot password?": a link emailed to the account's address lets its owner
// choose a new password. Works for any account, so an OAuth-only user can add
// a password this way too. Two-factor authentication still applies when they
// next sign in.
import '@tanstack/react-start/server-only'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { passwordResetTokens } from '~/server/db/schema'
import { sendEmail } from '~/server/email.server'
import { passwordResetEmail } from '~/server/emails.server'
import { ExpiringStore } from '~/server/expiring-store.server'
import { logger, reportError } from '~/server/logger.server'
import { findUserByEmail, replacePassword } from '~/server/users.server'

const linkLifetimeMs = 60 * 60_000
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

// So the form can't be used to flood an inbox, or to send mail at scale: at
// most this many requests for an address, and from an IP address, an hour.
const perEmail = 3
const perIp = 10
const requests = new ExpiringStore<number>(60 * 60_000)

function overLimit(key: string, limit: number) {
  const count = (requests.get(key) ?? 0) + 1
  requests.set(key, count)
  return count > limit
}

// Emails a reset link if there's an account with this address. The caller
// gets the same answer either way, so the form doesn't reveal who has an account.
export async function requestPasswordReset(email: string, origin: string, ip: string | null) {
  const address = email.toLowerCase()
  if (overLimit(`email:${address}`, perEmail) || (ip && overLimit(`ip:${ip}`, perIp))) {
    logger.info({ ip }, 'Password reset request throttled')
    return
  }
  const user = await findUserByEmail(address)
  if (!user) return

  const token = randomBytes(32).toString('base64url')
  await db.transaction(async (tx) => {
    // Only the newest link works.
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id))
    await tx
      .insert(passwordResetTokens)
      .values({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + linkLifetimeMs) })
  })
  const link = new URL(`/reset-password?token=${token}`, origin).toString()
  try {
    await sendEmail({ to: user.email, ...passwordResetEmail(link) }, undefined, origin)
  } catch (error) {
    reportError(error, { msg: 'Sending a password reset email failed', userId: user.id })
  }
}

// Whether the link's token can still be used, so the page can say so up front.
export async function isResetTokenValid(token: string) {
  const [row] = await db
    .select({ userId: passwordResetTokens.userId })
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, hashToken(token)), gt(passwordResetTokens.expiresAt, new Date())))
    .limit(1)
  return Boolean(row)
}

export async function resetPassword(token: string, password: string) {
  const [row] = await db
    .delete(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, hashToken(token)), gt(passwordResetTokens.expiresAt, new Date())))
    .returning({ userId: passwordResetTokens.userId })
  if (!row) return { ok: false as const, error: 'This link has expired or has already been used. Ask for a new one.' }
  await replacePassword(row.userId, password)
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.userId))
  logger.info({ userId: row.userId }, 'Password reset')
  return { ok: true as const }
}
