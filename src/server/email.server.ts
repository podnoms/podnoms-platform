// Sending email through an SMTP server: the one in SMTP_* environment variables
// if SMTP_HOST is set, otherwise the one admins entered on the admin page, and
// none (email is off) if neither is set.
import '@tanstack/react-start/server-only'
import { createTransport, type Transporter } from 'nodemailer'
import { env } from '~/env'
import type { EmailSettingsInput } from '~/lib/site-settings-schema'
import { renderEmail, type EmailMessage } from '~/server/emails.server'
import { logger } from '~/server/logger.server'
import { decryptSecret, encryptSecret } from '~/server/secrets.server'
import { getSiteSettings, updateSiteSettings } from '~/server/site-settings.server'
import { siteOrigin } from '~/server/site-url.server'

export type EmailConfig = {
  source: 'env' | 'admin'
  host: string
  port: number
  secure: boolean
  user: string | null
  password: string | null
  from: string
}


export async function getEmailConfig(): Promise<EmailConfig | null> {
  if (env.SMTP_HOST) {
    if (!env.EMAIL_FROM) {
      logger.warn('SMTP_HOST is set but EMAIL_FROM isn’t, so email is off')
      return null
    }
    return {
      source: 'env',
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER ?? null,
      password: env.SMTP_PASSWORD ?? null,
      from: env.EMAIL_FROM,
    }
  }
  const settings = await getSiteSettings()
  if (!settings.smtpHost || !settings.emailFrom) return null
  return {
    source: 'admin',
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    user: settings.smtpUser,
    password: settings.smtpPassword ? readPassword(settings.smtpPassword) : null,
    from: settings.emailFrom,
  }
}

// A password saved under another AUTH_SECRET can't be read; sending then fails
// to log in, which the admin page's test shows.
function readPassword(stored: string) {
  try {
    return decryptSecret('podnoms smtp password', stored)
  } catch {
    logger.warn('The saved SMTP password can’t be decrypted (has AUTH_SECRET changed?)')
    return null
  }
}

export const emailEnabled = async () => (await getEmailConfig()) !== null

// The email settings for the admin page: never the password, just whether
// there is one. `source` says where they come from (null when there are none).
export async function getEmailStatus() {
  const enabled = await emailEnabled()
  if (env.SMTP_HOST) {
    return {
      source: 'env' as 'env' | 'admin' | null,
      enabled,
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER ?? '',
      hasPassword: Boolean(env.SMTP_PASSWORD),
      from: env.EMAIL_FROM ?? '',
    }
  }
  const settings = await getSiteSettings()
  return {
    source: settings.smtpHost ? ('admin' as const) : null,
    enabled,
    host: settings.smtpHost ?? '',
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    user: settings.smtpUser ?? '',
    hasPassword: Boolean(settings.smtpPassword),
    from: settings.emailFrom ?? '',
  }
}

// Saves the settings entered on the admin page. Refused while the environment
// sets the server, as they'd have no effect.
export async function updateEmailSettings(input: EmailSettingsInput) {
  if (env.SMTP_HOST) return false
  const { smtpPassword, clearPassword, ...rest } = input
  await updateSiteSettings({
    ...rest,
    ...(clearPassword
      ? { smtpPassword: null }
      : smtpPassword
        ? { smtpPassword: encryptSecret('podnoms smtp password', smtpPassword) }
        : {}),
  })
  return true
}

// The config for settings as entered on the admin page, before they're saved:
// an empty password means the saved one.
export async function configFromSettings(input: EmailSettingsInput): Promise<EmailConfig | null> {
  if (!input.smtpHost || !input.emailFrom) return null
  const saved = await getSiteSettings()
  return {
    source: 'admin',
    host: input.smtpHost,
    port: input.smtpPort,
    secure: input.smtpSecure,
    user: input.smtpUser,
    password: input.clearPassword
      ? null
      : input.smtpPassword || (saved.smtpPassword ? readPassword(saved.smtpPassword) : null),
    from: input.emailFrom,
  }
}

// One transport per server, rebuilt when the settings change.
let transport: { key: string; transporter: Transporter } | null = null

function transporterFor(config: EmailConfig) {
  const key = JSON.stringify(config)
  if (transport?.key !== key) {
    transport?.transporter.close()
    transport = {
      key,
      transporter: createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      }),
    }
  }
  return transport.transporter
}

// Sends a message in the site's email layout (see emails.server.tsx), so every
// email looks the same. Throws if email is off or the server refuses it;
// callers decide whether that matters. `origin` is where the site is, for the
// layout's links; by default SITE_URL's.
export async function sendEmail(
  message: EmailMessage & { to: string },
  config?: EmailConfig | null,
  origin: string | null = emailOrigin(),
) {
  const using = config === undefined ? await getEmailConfig() : config
  if (!using) throw new Error('Email isn\u2019t set up on this site')
  const { to, subject } = message
  const { html, text, attachments } = await renderEmail(message, origin)
  const started = Date.now()
  try {
    await transporterFor(using).sendMail({ from: using.from, to, subject, html, text, attachments })
    logger.info({ to, subject, durationMs: Date.now() - started }, 'Email sent')
  } catch (error) {
    logger.warn({ to, subject, err: error }, 'Email not sent')
    throw error
  }
}

// Where links in emails point: SITE_URL, as emails sent by background jobs
// have no request to take the address from. Without it, those emails go out
// without links; emails sent while handling a request pass its address instead.
let warnedNoOrigin = false
export function emailOrigin(fallback?: string) {
  const origin = siteOrigin() ?? fallback ?? null
  if (!origin && !warnedNoOrigin) {
    warnedNoOrigin = true
    logger.warn('SITE_URL isn\u2019t set, so emails sent in the background have no links')
  }
  return origin
}
