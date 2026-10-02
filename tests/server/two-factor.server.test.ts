import { eq } from 'drizzle-orm'
import { Secret, TOTP } from 'otpauth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recoveryCodes, users } from '~/server/db/schema'
import {
  confirmTotpSetup,
  disableTotp,
  ensureRecoveryCodes,
  getTwoFactorMethods,
  getTwoFactorStatus,
  hasTwoFactor,
  maxFailedAttempts,
  redeemTwoFactorTicket,
  regenerateRecoveryCodes,
  removeSecurityKey,
  startTotpSetup,
  verifySecondFactor,
} from '~/server/two-factor.server'
import { finishKeyRegistration, startKeyAuthentication, startKeyRegistration } from '~/server/webauthn.server'
import { resetDb } from '../db'
import { fakeSecurityKey } from '../fake-authenticator'
import { createUser, db } from '../helpers'

const url = new URL('https://podnoms.example/')

beforeEach(async () => {
  await resetDb(db)
  // Only the clock: PGlite needs real timers.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
})

afterEach(() => vi.useRealTimers())

const codeFor = (secret: string) => new TOTP({ secret: Secret.fromBase32(secret) }).generate()
const nextPeriod = () => vi.setSystemTime(Date.now() + 30_000)

// A user with an authenticator app set up, and the app's secret.
async function userWithTotp() {
  const user = await createUser({ email: 'me@example.com' })
  const { secret } = await startTotpSetup(user.id)
  const result = await confirmTotpSetup(user.id, codeFor(secret))
  if (!result.ok) throw new Error(result.error)
  return { user, secret, recoveryCodes: result.recoveryCodes! }
}

async function addSecurityKey(userId: string) {
  const key = fakeSecurityKey()
  const options = await startKeyRegistration(userId, url)
  await finishKeyRegistration(userId, 'Key', key.register(options, url.origin), url)
  return key
}

describe('setting up an authenticator app', () => {
  it('gives a secret, an otpauth URI for the user and a QR code', async () => {
    const user = await createUser({ email: 'me@example.com' })
    const setup = await startTotpSetup(user.id)
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\/podnoms:me%40example\.com\?/)
    expect(setup.uri).toContain(`secret=${setup.secret}`)
    expect(setup.qrCode).toMatch(/^data:image\/png;base64,/)
  })

  it("isn't turned on until a code from the app is confirmed", async () => {
    const user = await createUser()
    const { secret } = await startTotpSetup(user.id)
    expect(await hasTwoFactor(user.id)).toBe(false)
    expect(await confirmTotpSetup(user.id, '000000')).toEqual({ ok: false, error: expect.any(String) })
    expect(await hasTwoFactor(user.id)).toBe(false)

    const result = await confirmTotpSetup(user.id, codeFor(secret))
    expect(result).toEqual({ ok: true, recoveryCodes: expect.any(Array) })
    expect(await getTwoFactorMethods(user.id)).toEqual({ totp: true, securityKey: false })
  })

  it('stores the secret encrypted', async () => {
    const { user, secret } = await userWithTotp()
    const [row] = await db.select().from(users).where(eq(users.id, user.id))
    expect(row!.totpSecret).toBeTruthy()
    expect(row!.totpSecret).not.toContain(secret)
  })

  it('times out', async () => {
    const user = await createUser()
    const { secret } = await startTotpSetup(user.id)
    vi.setSystemTime(Date.now() + 16 * 60_000)
    expect(await confirmTotpSetup(user.id, codeFor(secret))).toMatchObject({ ok: false, error: /timed out/ })
  })
})

describe('recovery codes', () => {
  it('are made when 2FA is first turned on, and not again while some are left', async () => {
    const { user, recoveryCodes: codes } = await userWithTotp()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const code of codes) expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/)
    expect(await ensureRecoveryCodes(user.id)).toBeNull()
  })

  it('are stored hashed', async () => {
    const { user, recoveryCodes: codes } = await userWithTotp()
    const rows = await db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, user.id))
    expect(rows).toHaveLength(10)
    for (const row of rows) expect(codes).not.toContain(row.codeHash)
  })

  it('each work once, ignoring case and dashes', async () => {
    const { user, recoveryCodes: codes } = await userWithTotp()
    const code = codes[0]!
    expect(await verifySecondFactor(user.id, { method: 'recovery', code: code.toUpperCase().replace('-', '') }, url)).toMatchObject({ ok: true })
    expect(await verifySecondFactor(user.id, { method: 'recovery', code }, url)).toMatchObject({ ok: false })
    expect((await getTwoFactorStatus(user.id)).recoveryCodesLeft).toBe(9)
  })

  it('are replaced when regenerated', async () => {
    const { user, recoveryCodes: old } = await userWithTotp()
    const fresh = await regenerateRecoveryCodes(user.id)
    expect(fresh.some((code) => old.includes(code))).toBe(false)
    expect(await verifySecondFactor(user.id, { method: 'recovery', code: old[0]! }, url)).toMatchObject({ ok: false })
    expect(await verifySecondFactor(user.id, { method: 'recovery', code: fresh[0]! }, url)).toMatchObject({ ok: true })
  })

  it("don't work for another user", async () => {
    const { recoveryCodes: codes } = await userWithTotp()
    const other = await createUser()
    await addSecurityKey(other.id)
    expect(await verifySecondFactor(other.id, { method: 'recovery', code: codes[0]! }, url)).toMatchObject({ ok: false })
  })
})

describe('turning factors off', () => {
  it('keeps 2FA and recovery codes while another factor is left', async () => {
    const { user } = await userWithTotp()
    const key = await addSecurityKey(user.id)
    await disableTotp(user.id)
    expect(await getTwoFactorMethods(user.id)).toEqual({ totp: false, securityKey: true })
    expect((await getTwoFactorStatus(user.id)).recoveryCodesLeft).toBe(10)

    await removeSecurityKey(user.id, key.id)
    expect(await getTwoFactorStatus(user.id)).toEqual({
      enabled: false,
      totp: false,
      securityKeys: [],
      recoveryCodesLeft: 0,
    })
  })

  it("can't remove another user's key", async () => {
    const owner = await createUser()
    const key = await addSecurityKey(owner.id)
    const other = await createUser()
    await removeSecurityKey(other.id, key.id)
    expect((await getTwoFactorStatus(owner.id)).securityKeys).toHaveLength(1)
  })
})

describe('verifySecondFactor', () => {
  it('accepts a current code once, and the next one after it', async () => {
    const { user, secret } = await userWithTotp()
    nextPeriod()
    const code = codeFor(secret)
    expect(await verifySecondFactor(user.id, { method: 'totp', code }, url)).toEqual({ ok: true, ticket: expect.any(String) })
    expect(await verifySecondFactor(user.id, { method: 'totp', code }, url)).toMatchObject({ ok: false })
    nextPeriod()
    expect(await verifySecondFactor(user.id, { method: 'totp', code: codeFor(secret) }, url)).toMatchObject({ ok: true })
  })

  it('refuses the code used to set the app up', async () => {
    const user = await createUser()
    const { secret } = await startTotpSetup(user.id)
    const code = codeFor(secret)
    await confirmTotpSetup(user.id, code)
    expect(await verifySecondFactor(user.id, { method: 'totp', code }, url)).toMatchObject({ ok: false })
  })

  it('allows a period of clock drift, but not more', async () => {
    const { user, secret } = await userWithTotp()
    vi.setSystemTime(Date.now() + 5 * 60_000)
    const late = codeFor(secret)
    vi.setSystemTime(Date.now() + 30_000)
    expect(await verifySecondFactor(user.id, { method: 'totp', code: late }, url)).toMatchObject({ ok: true })
    const stale = codeFor(secret)
    vi.setSystemTime(Date.now() + 90_000)
    expect(await verifySecondFactor(user.id, { method: 'totp', code: stale }, url)).toMatchObject({ ok: false })
  })

  it('refuses codes for users without an app', async () => {
    const user = await createUser()
    expect(await verifySecondFactor(user.id, { method: 'totp', code: '123456' }, url)).toMatchObject({ ok: false })
  })

  it('accepts a security key', async () => {
    const user = await createUser()
    const key = await addSecurityKey(user.id)
    const response = key.authenticate((await startKeyAuthentication(user.id, url))!, url.origin)
    expect(await verifySecondFactor(user.id, { method: 'securityKey', response }, url)).toMatchObject({ ok: true })
  })

  it(`locks the user out after ${maxFailedAttempts} wrong attempts, until they stop trying`, async () => {
    const { user, secret } = await userWithTotp()
    for (let i = 0; i < maxFailedAttempts; i++) {
      expect(await verifySecondFactor(user.id, { method: 'totp', code: '000000' }, url)).toMatchObject({ ok: false })
    }
    nextPeriod()
    expect(await verifySecondFactor(user.id, { method: 'totp', code: codeFor(secret) }, url)).toMatchObject({
      ok: false,
      error: /Too many failed attempts/,
    })
    vi.setSystemTime(Date.now() + 16 * 60_000)
    expect(await verifySecondFactor(user.id, { method: 'totp', code: codeFor(secret) }, url)).toMatchObject({ ok: true })
  })

  it('forgets failed attempts after a success', async () => {
    const { user, secret } = await userWithTotp()
    for (let i = 0; i < maxFailedAttempts - 1; i++) {
      await verifySecondFactor(user.id, { method: 'totp', code: '000000' }, url)
    }
    nextPeriod()
    expect(await verifySecondFactor(user.id, { method: 'totp', code: codeFor(secret) }, url)).toMatchObject({ ok: true })
    await verifySecondFactor(user.id, { method: 'totp', code: '000000' }, url)
    nextPeriod()
    expect(await verifySecondFactor(user.id, { method: 'totp', code: codeFor(secret) }, url)).toMatchObject({ ok: true })
  })
})

describe('redeemTwoFactorTicket', () => {
  it('works once, for the user it was issued to, within two minutes', async () => {
    const { user, recoveryCodes: codes } = await userWithTotp()
    const issue = async (code: string) => {
      const result = await verifySecondFactor(user.id, { method: 'recovery', code }, url)
      if (!result.ok) throw new Error(result.error)
      return result.ticket
    }

    const ticket = await issue(codes[0]!)
    expect(redeemTwoFactorTicket(ticket, 'someone-else')).toBe(false)
    const another = await issue(codes[1]!)
    expect(redeemTwoFactorTicket(another, user.id)).toBe(true)
    expect(redeemTwoFactorTicket(another, user.id)).toBe(false)

    const late = await issue(codes[2]!)
    vi.setSystemTime(Date.now() + 3 * 60_000)
    expect(redeemTwoFactorTicket(late, user.id)).toBe(false)
    expect(redeemTwoFactorTicket(undefined, user.id)).toBe(false)
  })
})
