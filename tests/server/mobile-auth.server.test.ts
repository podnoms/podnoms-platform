import { eq } from 'drizzle-orm'
import { Secret, TOTP } from 'otpauth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mobileTokens } from '~/server/db/schema'
import {
  finishMobileSignIn,
  issueMobileToken,
  mobileUserId,
  revokeMobileToken,
  startMobileSignIn,
} from '~/server/mobile-auth.server'
import { confirmTotpSetup, startTotpSetup } from '~/server/two-factor.server'
import { createUser } from '~/server/users.server'
import { resetDb } from '../db'
import { db } from '../helpers'

const url = new URL('https://podnoms.example/')
const withToken = (token: string) => new Request('http://x/', { headers: { authorization: `Bearer ${token}` } })
const codeFor = (secret: string) => new TOTP({ secret: Secret.fromBase32(secret) }).generate()

beforeEach(async () => {
  await resetDb(db)
  // Only the clock: PGlite needs real timers.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
})

afterEach(() => vi.useRealTimers())

async function userWithTotp() {
  const user = (await createUser('me@example.com', 'password123'))!
  const { secret } = await startTotpSetup(user.id)
  const result = await confirmTotpSetup(user.id, codeFor(secret))
  if (!result.ok) throw new Error(result.error)
  // A code can't be used twice, so sign-in waits for the next one.
  vi.setSystemTime(Date.now() + 30_000)
  return { user, secret, recoveryCodes: result.recoveryCodes! }
}

describe('tokens', () => {
  it('stores only a hash, and finds the user by the token', async () => {
    const user = (await createUser('me@example.com', 'password123'))!
    const token = await issueMobileToken(user.id, 'Pixel')
    const [row] = await db.select().from(mobileTokens)
    expect(row!.tokenHash).not.toContain(token)
    expect(row!.deviceName).toBe('Pixel')
    expect(await mobileUserId(withToken(token))).toBe(user.id)
  })

  it('refuses unknown, missing and revoked tokens', async () => {
    const user = (await createUser('me@example.com', 'password123'))!
    const token = await issueMobileToken(user.id)
    expect(await mobileUserId(withToken('nope'))).toBeNull()
    expect(await mobileUserId(new Request('http://x/'))).toBeNull()
    await revokeMobileToken(token)
    expect(await mobileUserId(withToken(token))).toBeNull()
  })

  it('brings lastUsedAt up to date at most hourly', async () => {
    const user = (await createUser('me@example.com', 'password123'))!
    const token = await issueMobileToken(user.id)
    const lastUsed = async () => (await db.select().from(mobileTokens).where(eq(mobileTokens.userId, user.id)))[0]!.lastUsedAt
    const first = await lastUsed()
    vi.setSystemTime(Date.now() + 10 * 60_000)
    await mobileUserId(withToken(token))
    expect(await lastUsed()).toEqual(first)
    vi.setSystemTime(Date.now() + 60 * 60_000)
    await mobileUserId(withToken(token))
    expect((await lastUsed()).getTime()).toBeGreaterThan(first.getTime())
  })
})

describe('signing in', () => {
  it('gives a token for the right password', async () => {
    const user = (await createUser('me@example.com', 'password123'))!
    const result = await startMobileSignIn('me@example.com', 'password123')
    expect(result).toEqual({ status: 'signed-in', token: expect.any(String) })
    if (result.status === 'signed-in') expect(await mobileUserId(withToken(result.token))).toBe(user.id)
  })

  it('refuses the wrong password', async () => {
    await createUser('me@example.com', 'password123')
    expect(await startMobileSignIn('me@example.com', 'wrong-password')).toEqual({ status: 'refused' })
  })

  it('asks for a second factor, then gives a token for the right code', async () => {
    const { user, secret } = await userWithTotp()
    const started = await startMobileSignIn('me@example.com', 'password123')
    expect(started).toMatchObject({ status: 'two-factor', methods: { totp: true, recovery: true } })
    if (started.status !== 'two-factor') return

    expect(await finishMobileSignIn(started.challenge, { method: 'totp', code: '000000' }, url)).toMatchObject({ ok: false })
    const finished = await finishMobileSignIn(started.challenge, { method: 'totp', code: codeFor(secret) }, url)
    expect(finished).toEqual({ ok: true, token: expect.any(String) })
    if (finished.ok) expect(await mobileUserId(withToken(finished.token))).toBe(user.id)
    // The challenge is used up.
    expect(await finishMobileSignIn(started.challenge, { method: 'recovery', code: 'x' }, url)).toMatchObject({ expired: true })
  })

  it('takes a recovery code', async () => {
    const { recoveryCodes } = await userWithTotp()
    const started = await startMobileSignIn('me@example.com', 'password123')
    if (started.status !== 'two-factor') throw new Error('Expected a challenge')
    expect(await finishMobileSignIn(started.challenge, { method: 'recovery', code: recoveryCodes[0]! }, url)).toMatchObject({ ok: true })
  })

  it('lets a challenge expire', async () => {
    const { secret } = await userWithTotp()
    const started = await startMobileSignIn('me@example.com', 'password123')
    if (started.status !== 'two-factor') throw new Error('Expected a challenge')
    vi.setSystemTime(Date.now() + 6 * 60_000)
    expect(await finishMobileSignIn(started.challenge, { method: 'totp', code: codeFor(secret) }, url)).toMatchObject({
      ok: false,
      expired: true,
    })
  })

  it('locks the user out after too many wrong codes', async () => {
    const { secret } = await userWithTotp()
    const started = await startMobileSignIn('me@example.com', 'password123')
    if (started.status !== 'two-factor') throw new Error('Expected a challenge')
    for (let i = 0; i < 5; i++) await finishMobileSignIn(started.challenge, { method: 'totp', code: '000000' }, url)
    expect(await finishMobileSignIn(started.challenge, { method: 'totp', code: codeFor(secret) }, url)).toMatchObject({
      ok: false,
      error: /Too many/,
    })
  })
})
