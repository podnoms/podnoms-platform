import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { passwordResetTokens } from '~/server/db/schema'
import { isResetTokenValid, requestPasswordReset, resetPassword } from '~/server/password-reset.server'
import { renderEmail, type EmailMessage } from '~/server/emails.server'
import { createUser as createPasswordUser, verifyUser } from '~/server/users.server'
import { resetDb } from '../db'
import { createUser, db } from '../helpers'

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn(async () => {}) }))
vi.mock('~/server/email.server', () => ({ sendEmail }))

const origin = 'https://pods.example'
let ip = 0
// A different IP each time, so the per-IP limit only applies where a test wants it.
const nextIp = () => `10.0.0.${++ip}`

beforeEach(async () => {
  await resetDb(db)
  sendEmail.mockClear()
})

// The token from the link in the last email sent.
async function sentToken() {
  const [[email]] = sendEmail.mock.calls.slice(-1) as unknown as [[EmailMessage & { to: string }]]
  const { text } = await renderEmail(email, origin)
  return { to: email.to, token: /token=([\w-]+)/.exec(text)![1]! }
}

describe('requestPasswordReset', () => {
  it('emails a link, storing only a hash of its token', async () => {
    await createPasswordUser('a@example.com', 'old-password')
    await requestPasswordReset('A@Example.com', origin, nextIp())
    const { to, token } = (await sentToken())
    expect(to).toBe('a@example.com')
    const rows = await db.select().from(passwordResetTokens)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(JSON.stringify(rows)).not.toContain(token)
  })

  it("does nothing, without saying so, for an address that has no account", async () => {
    await expect(requestPasswordReset('nobody@example.com', origin, nextIp())).resolves.toBeUndefined()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('only keeps the newest link', async () => {
    await createPasswordUser('b@example.com', 'old-password')
    await requestPasswordReset('b@example.com', origin, nextIp())
    const first = (await sentToken()).token
    await requestPasswordReset('b@example.com', origin, nextIp())
    expect(await isResetTokenValid(first)).toBe(false)
    expect(await isResetTokenValid((await sentToken()).token)).toBe(true)
  })

  it('sends at most three links an hour to an address', async () => {
    await createPasswordUser('c@example.com', 'old-password')
    for (let i = 0; i < 5; i++) await requestPasswordReset('c@example.com', origin, nextIp())
    expect(sendEmail).toHaveBeenCalledTimes(3)
  })

  it('takes at most ten requests an hour from an IP address', async () => {
    for (let i = 0; i < 12; i++) await createPasswordUser(`ip${i}@example.com`, 'old-password')
    for (let i = 0; i < 12; i++) await requestPasswordReset(`ip${i}@example.com`, origin, '192.0.2.1')
    expect(sendEmail).toHaveBeenCalledTimes(10)
  })
})

describe('resetPassword', () => {
  it('sets the new password, once', async () => {
    await createPasswordUser('d@example.com', 'old-password')
    await requestPasswordReset('d@example.com', origin, nextIp())
    const { token } = (await sentToken())
    expect(await resetPassword(token, 'new-password')).toEqual({ ok: true })
    expect(await verifyUser('d@example.com', 'new-password')).not.toBeNull()
    expect(await verifyUser('d@example.com', 'old-password')).toBeNull()
    expect(await resetPassword(token, 'another-password')).toMatchObject({ ok: false })
  })

  it('refuses an expired link', async () => {
    const user = await createPasswordUser('e@example.com', 'old-password')
    await requestPasswordReset('e@example.com', origin, nextIp())
    const { token } = (await sentToken())
    await db.update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResetTokens.userId, user!.id))
    expect(await isResetTokenValid(token)).toBe(false)
    expect(await resetPassword(token, 'new-password')).toMatchObject({ ok: false })
    expect(await verifyUser('e@example.com', 'old-password')).not.toBeNull()
  })

  it('lets a user who signed up with OAuth set a password', async () => {
    await createUser({ email: 'oauth@example.com' })
    await requestPasswordReset('oauth@example.com', origin, nextIp())
    expect(await resetPassword((await sentToken()).token, 'new-password')).toEqual({ ok: true })
    expect(await verifyUser('oauth@example.com', 'new-password')).not.toBeNull()
  })

  it('refuses a made-up token', async () => {
    expect(await resetPassword('nonsense', 'new-password')).toMatchObject({ ok: false })
  })
})
