import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../db'
import { db } from '../helpers'

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(async () => ({ messageId: '1' }))
  return { sendMail, createTransport: vi.fn(() => ({ sendMail, close: vi.fn() })) }
})
vi.mock('nodemailer', () => ({ createTransport }))

beforeEach(async () => {
  await resetDb(db)
  sendMail.mockClear()
  createTransport.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

const adminSettings = {
  smtpHost: 'smtp.admin.example',
  smtpPort: 2525,
  smtpSecure: false,
  smtpUser: 'admin-user',
  smtpPassword: 'admin-pass',
  clearPassword: false,
  emailFrom: 'podnoms <admin@example.com>',
}

// Loads the modules afresh with the given environment, as src/env.ts reads it once.
async function load(smtpEnv?: Record<string, string>) {
  vi.resetModules()
  for (const [name, value] of Object.entries(smtpEnv ?? {})) vi.stubEnv(name, value)
  const email = await import('~/server/email.server')
  const { updateSiteSettings } = await import('~/server/site-settings.server')
  // Each test starts with no admin settings.
  await updateSiteSettings({ smtpHost: null, smtpPassword: null, emailFrom: null, smtpUser: null })
  return email
}

describe('getEmailConfig', () => {
  it('is null when nothing is set up', async () => {
    const { getEmailConfig, emailEnabled } = await load()
    expect(await getEmailConfig()).toBeNull()
    expect(await emailEnabled()).toBe(false)
  })

  it("uses the admin's settings, keeping the password encrypted in the database", async () => {
    const { getEmailConfig, updateEmailSettings } = await load()
    expect(await updateEmailSettings(adminSettings)).toBe(true)
    expect(await getEmailConfig()).toEqual({
      source: 'admin',
      host: 'smtp.admin.example',
      port: 2525,
      secure: false,
      user: 'admin-user',
      password: 'admin-pass',
      from: 'podnoms <admin@example.com>',
    })
    const { getSiteSettings } = await import('~/server/site-settings.server')
    const stored = (await getSiteSettings()).smtpPassword!
    expect(stored).not.toContain('admin-pass')
  })

  it('keeps the saved password when none is entered, and removes it when asked', async () => {
    const { getEmailConfig, updateEmailSettings } = await load()
    await updateEmailSettings(adminSettings)
    await updateEmailSettings({ ...adminSettings, smtpPassword: '' })
    expect((await getEmailConfig())!.password).toBe('admin-pass')
    await updateEmailSettings({ ...adminSettings, smtpPassword: '', clearPassword: true })
    expect((await getEmailConfig())!.password).toBeNull()
  })

  it('prefers the environment, and refuses admin changes then', async () => {
    const { getEmailConfig, updateEmailSettings, getEmailStatus } = await load({
      SMTP_HOST: 'smtp.env.example',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'env-user',
      SMTP_PASSWORD: 'env-pass',
      EMAIL_FROM: 'env@example.com',
    })
    expect(await updateEmailSettings(adminSettings)).toBe(false)
    expect(await getEmailConfig()).toMatchObject({ source: 'env', host: 'smtp.env.example', port: 465, secure: true })
    const status = await getEmailStatus()
    expect(status).toMatchObject({ source: 'env', enabled: true, hasPassword: true })
    expect(JSON.stringify(status)).not.toContain('env-pass')
  })
})

describe('sendEmail', () => {
  it('sends through the configured server, from its address', async () => {
    const { sendEmail, updateEmailSettings } = await load()
    await updateEmailSettings(adminSettings)
    await sendEmail({ to: 'a@example.com', subject: 'Hi', preview: 'Hello there', content: 'Hello' })
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.admin.example', port: 2525, auth: { user: 'admin-user', pass: 'admin-pass' } }),
    )
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'podnoms <admin@example.com>', to: 'a@example.com', subject: 'Hi' }),
    )
    // In the site's layout, as HTML and plain text.
    const [[sent]] = sendMail.mock.calls as unknown as [[{ html: string; text: string; attachments: { cid: string }[] }]]
    expect(sent.html).toContain('Robot powered podcasts')
    expect(sent.text).toContain('Hello')
    expect(sent.attachments.map((attachment) => attachment.cid)).toEqual(['logo@podnoms'])
  })

  it('throws when email is off', async () => {
    const { sendEmail } = await load()
    await expect(sendEmail({ to: 'a@example.com', subject: 'Hi', preview: '', content: '' })).rejects.toThrow()
  })
})
