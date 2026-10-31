// Alerts to the site's admins about the site itself, rather than anyone's
// shows, in their notifications menu and by email: a platform asking us to
// prove we're not a bot, which stops downloads from it for every user until
// someone gives yt-dlp fresh cookies (YTDLP_COOKIES_FILE); someone trying to
// use an explicit image (image-moderation.server.ts); and reports of images
// (reports.server.ts).
import '@tanstack/react-start/server-only'
import { eq, sql } from 'drizzle-orm'
import type { Platform } from '~/lib/platforms'
import type { ReportReason } from '~/lib/report-schema'
import { db } from '~/server/db/client.server'
import { siteSettings, users } from '~/server/db/schema'
import { emailEnabled, emailOrigin, sendEmail } from '~/server/email.server'
import { blockedImageEmail, botCheckEmail, contentReportEmail } from '~/server/emails.server'
import type { EmailMessage } from '~/server/emails.server'
import { recordNotification, type NotificationKind } from '~/server/inbox.server'
import { reportError } from '~/server/logger.server'
import { internalKeyPrefix } from '~/server/site-settings.server'
import { getBranding } from '~/server/branding.server'

const botCheck = /confirm you.?re not a bot/i

// However many downloads hit it, admins hear at most this often per platform.
export const botCheckAlertIntervalMs = 6 * 60 * 60_000

// When admins were last told about each platform, kept as the app's own
// "__botCheckAlert:<platform>" in site_settings so a restart doesn't repeat it.
export const botCheckAlertKey = (platform: Platform) => `${internalKeyPrefix}botCheckAlert:${platform}`

// Takes the turn to alert under `key`, if it's been `intervalMs` since the
// last; only one caller wins when several happen at once.
async function claimAlert(key: string, intervalMs: number, now: Date) {
  const since = new Date(now.getTime() - intervalMs).toISOString()
  const claimed = await db
    .insert(siteSettings)
    .values({ key, value: now.toISOString() })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: sql`excluded.value`, updatedAt: now },
      setWhere: sql`${siteSettings.value} #>> '{}' < ${since}`,
    })
    .returning({ key: siteSettings.key })
  return claimed.length > 0
}

const listAdmins = () => db.select({ id: users.id, email: users.email }).from(users).where(eq(users.isAdmin, true))

// Puts the alert in every admin's notifications menu, and emails it to them
// when the site can send email.
async function tellAdmins(
  admins: { id: string; email: string | null }[],
  kind: NotificationKind,
  path: string,
  makeEmail: (link: string | null, siteName: string) => EmailMessage,
) {
  const origin = emailOrigin()
  const email = makeEmail(origin ? new URL(path, origin).toString() : null, (await getBranding()).name)
  await recordNotification(
    admins.map((admin) => admin.id),
    { kind, title: email.subject, body: email.preview, url: path },
  )
  if (!(await emailEnabled())) return
  for (const { email: to } of admins) {
    if (!to) continue
    await sendEmail({ to, ...email }).catch((sendError: unknown) =>
      reportError(sendError, { msg: `Sending a ${kind} alert failed`, to }),
    )
  }
}

export async function alertAdminsOfBotCheck(platform: Platform, error: string, now = new Date()) {
  const admins = await listAdmins()
  if (!admins.length || !(await claimAlert(botCheckAlertKey(platform), botCheckAlertIntervalMs, now))) return
  await tellAdmins(admins, 'botCheck', '/admin', (link, siteName) => botCheckEmail(platform, error, link, siteName))
}

// However many explicit images someone tries, admins hear at most this often
// per user (or, for thumbnails, at all).
export const blockedImageAlertIntervalMs = 24 * 60 * 60_000

// For an image refused as sexually explicit (the highest severity): who
// tried to use it, or the address it was downloaded from.
export async function alertAdminsOfBlockedImage(context: { userId?: string; source?: string }, now = new Date()) {
  const admins = await listAdmins()
  const key = `${internalKeyPrefix}blockedImageAlert:${context.userId ?? 'downloads'}`
  if (!admins.length || !(await claimAlert(key, blockedImageAlertIntervalMs, now))) return
  const [user] = context.userId
    ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, context.userId))
    : []
  const who = user ? (user.name ? `${user.name} (${user.email})` : (user.email ?? context.userId!)) : null
  await tellAdmins(admins, 'blockedImage', '/admin?tab=moderation', (link, siteName) =>
    blockedImageEmail(who, context.source ?? null, link, siteName),
  )
}

// For a new report of an image. Every report goes in the notifications menu;
// only child safety reports are emailed, straight away.
export async function alertAdminsOfReport(report: { reason: ReportReason; what: string }) {
  const admins = await listAdmins()
  if (!admins.length) return
  const path = '/admin?tab=moderation'
  if (report.reason === 'childSafety') {
    await tellAdmins(admins, 'contentReport', path, (link, siteName) => contentReportEmail(report, link, siteName))
    return
  }
  const email = contentReportEmail(report, null, '')
  await recordNotification(
    admins.map((admin) => admin.id),
    { kind: 'contentReport', title: email.subject, body: email.preview, url: path },
  )
}

// For a download that failed with `error`: alerts the admins if it was a bot
// check. Never gets in the way of the download's own handling.
export function alertIfBotCheck(platform: Platform, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (!botCheck.test(message)) return
  void alertAdminsOfBotCheck(platform, message).catch((alertError: unknown) =>
    reportError(alertError, { msg: 'Alerting admins of a bot check failed', platform }),
  )
}
