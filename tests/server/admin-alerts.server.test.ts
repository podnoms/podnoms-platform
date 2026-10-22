import { beforeEach, describe, expect, it, vi } from 'vitest'
import { alertAdminsOfBotCheck, alertIfBotCheck, botCheckAlertIntervalMs } from '~/server/admin-alerts.server'
import { RateLimitedError, resetThrottle, withDownloadSlot } from '~/server/download-throttle.server'
import { renderEmail, type EmailMessage } from '~/server/emails.server'
import { getSiteSettings } from '~/server/site-settings.server'
import { resetDb } from '../db'
import { createUser, db } from '../helpers'

const email = vi.hoisted(() => ({
  enabled: true,
  sendEmail: vi.fn(async (_email: EmailMessage & { to: string }) => {}),
}))
vi.mock('~/server/email.server', () => ({
  emailEnabled: async () => email.enabled,
  emailOrigin: () => 'https://pods.example',
  sendEmail: email.sendEmail,
}))

const botCheck =
  "Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication."

beforeEach(async () => {
  await resetDb(db)
  resetThrottle()
  email.enabled = true
  email.sendEmail.mockReset()
})

// Lets the fire-and-forget alert finish.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const sentTo = () => email.sendEmail.mock.calls.map(([sent]) => sent.to).sort()

describe('bot check alerts', () => {
  it('emails every admin, whoever the download was for', async () => {
    await createUser({ email: 'first@example.com', isAdmin: true })
    await createUser({ email: 'second@example.com', isAdmin: true })
    await createUser({ email: 'listener@example.com' })
    await alertAdminsOfBotCheck('youtube', botCheck)
    expect(sentTo()).toEqual(['first@example.com', 'second@example.com'])
    const [sent] = email.sendEmail.mock.calls[0]!
    expect(sent.subject).toBe('YouTube is asking podnoms to prove it isn’t a bot')
    const { text } = await renderEmail(sent, 'https://pods.example')
    expect(text).toContain('YTDLP_COOKIES_FILE')
    expect(text).toContain('https://pods.example/admin')
    expect(text).toContain(botCheck)
  })

  it('emails at most every 6 hours per platform', async () => {
    await createUser({ email: 'admin@example.com', isAdmin: true })
    const start = new Date('2026-10-22T12:00:00Z')
    await alertAdminsOfBotCheck('youtube', botCheck, start)
    await alertAdminsOfBotCheck('youtube', botCheck, new Date(start.getTime() + botCheckAlertIntervalMs - 1000))
    expect(email.sendEmail).toHaveBeenCalledTimes(1)

    await alertAdminsOfBotCheck('mixcloud', botCheck, start)
    expect(email.sendEmail).toHaveBeenCalledTimes(2)

    await alertAdminsOfBotCheck('youtube', botCheck, new Date(start.getTime() + botCheckAlertIntervalMs + 1000))
    expect(email.sendEmail).toHaveBeenCalledTimes(3)
  })

  it('sends one email when several downloads hit it at once', async () => {
    await createUser({ email: 'admin@example.com', isAdmin: true })
    await Promise.all([1, 2, 3].map(() => alertAdminsOfBotCheck('youtube', botCheck)))
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
  })

  it("doesn't use up its turn when email is off", async () => {
    await createUser({ email: 'admin@example.com', isAdmin: true })
    email.enabled = false
    await alertAdminsOfBotCheck('youtube', botCheck)
    email.enabled = true
    await alertAdminsOfBotCheck('youtube', botCheck)
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('ignores other failures', async () => {
    await createUser({ email: 'admin@example.com', isAdmin: true })
    alertIfBotCheck('youtube', new RateLimitedError('HTTP Error 429: Too Many Requests'))
    alertIfBotCheck('youtube', new Error('Video unavailable'))
    await settle()
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('is raised by a download refused with a bot check', async () => {
    await createUser({ email: 'admin@example.com', isAdmin: true })
    const refused = withDownloadSlot('youtube', { key: 'p1' }, async () => {
      throw new RateLimitedError(botCheck)
    })
    await expect(refused).rejects.toThrow(RateLimitedError)
    await settle()
    expect(sentTo()).toEqual(['admin@example.com'])
  })

  it('keeps when it last alerted out of the site settings', async () => {
    await createUser({ email: 'admin@example.com', isAdmin: true })
    await alertAdminsOfBotCheck('youtube', botCheck)
    expect(Object.keys(await getSiteSettings()).some((key) => key.includes('botCheck'))).toBe(false)
  })
})
