// Alerts to the site's admins about the site itself, rather than anyone's
// podcasts, in their notifications menu and by email: for now, a platform asking us to prove we're not a bot, which
// stops downloads from it for every user until someone gives yt-dlp fresh
// cookies (YTDLP_COOKIES_FILE).
import '@tanstack/react-start/server-only'
import { eq, sql } from 'drizzle-orm'
import type { Platform } from '~/lib/platforms'
import { db } from '~/server/db/client.server'
import { siteSettings, users } from '~/server/db/schema'
import { emailEnabled, emailOrigin, sendEmail } from '~/server/email.server'
import { botCheckEmail } from '~/server/emails.server'
import { recordNotification } from '~/server/inbox.server'
import { reportError } from '~/server/logger.server'
import { internalKeyPrefix } from '~/server/site-settings.server'

const botCheck = /confirm you.?re not a bot/i

// However many downloads hit it, admins hear at most this often per platform.
export const botCheckAlertIntervalMs = 6 * 60 * 60_000

// When admins were last told about each platform, kept as the app's own
// "__botCheckAlert:<platform>" in site_settings so a restart doesn't repeat it.
export const botCheckAlertKey = (platform: Platform) => `${internalKeyPrefix}botCheckAlert:${platform}`

// Takes the platform's turn to alert, if it's been long enough since the last;
// only one caller wins when several downloads fail at once.
async function claimBotCheckAlert(platform: Platform, now: Date) {
  const since = new Date(now.getTime() - botCheckAlertIntervalMs).toISOString()
  const claimed = await db
    .insert(siteSettings)
    .values({ key: botCheckAlertKey(platform), value: now.toISOString() })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: sql`excluded.value`, updatedAt: now },
      setWhere: sql`${siteSettings.value} #>> '{}' < ${since}`,
    })
    .returning({ key: siteSettings.key })
  return claimed.length > 0
}

// Goes in every admin's notifications menu, and is emailed to them when the
// site can send email.
export async function alertAdminsOfBotCheck(platform: Platform, error: string, now = new Date()) {
  const admins = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.isAdmin, true))
  if (!admins.length || !(await claimBotCheckAlert(platform, now))) return
  const origin = emailOrigin()
  const email = botCheckEmail(platform, error, origin ? new URL('/admin', origin).toString() : null)
  await recordNotification(
    admins.map((admin) => admin.id),
    { kind: 'botCheck', title: email.subject, body: email.preview, url: '/admin' },
  )
  if (!(await emailEnabled())) return
  for (const { email: to } of admins) {
    if (!to) continue
    await sendEmail({ to, ...email }).catch((sendError: unknown) =>
      reportError(sendError, { msg: 'Sending a bot check alert failed', to }),
    )
  }
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
