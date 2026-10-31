// Reports of images that shouldn't be on the site, from the Report button on
// show, episode and profile pages, for whatever the automatic check
// (image-moderation.server.ts) misses. Anyone can report, signed in or not;
// admins deal with them on the admin page's Moderation tab, by removing the
// image, taking it down but keeping a copy as evidence (for child abuse
// imagery, which must be reported to the authorities rather than deleted), or
// dismissing the report. All the open reports of an image are dealt with
// together.
import '@tanstack/react-start/server-only'
import { copyFile } from 'node:fs/promises'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { env } from '~/env'
import { episodePath, showPath, userPath } from '~/lib/paths'
import type { ReportInput, ReportReason, ReportResolution, ReportTargetKind } from '~/lib/report-schema'
import { alertAdminsOfReport } from '~/server/admin-alerts.server'
import { saltFor, visitorHash } from '~/server/activity.server'
import { db } from '~/server/db/client.server'
import { contentReports, episodes, shows, users } from '~/server/db/schema'
import { deleteImage, localImageUrl } from '~/server/images.server'
import { reportError } from '~/server/logger.server'
import { siteOrigin } from '~/server/site-url.server'
import { ensureQuarantineDir, imagePath, quarantinePath } from '~/server/storage.server'

// However many images they report, each visitor's reports a day stop here.
export const maxReportsPerDay = 20

type Target = { imageUrl: string | null; ownerId: string; what: string; path: string }

// What's reported: its image now, whose it is, what to call it and where it is.
async function findTarget(kind: ReportTargetKind, id: string): Promise<Target | null> {
  if (kind === 'show') {
    const [row] = await db
      .select({ imageUrl: shows.imageUrl, ownerId: shows.userId, title: shows.title, slug: shows.slug })
      .from(shows)
      .where(eq(shows.id, id))
    return row ? { imageUrl: row.imageUrl, ownerId: row.ownerId, what: `the show “${row.title}”`, path: showPath(row.slug) } : null
  }
  if (kind === 'episode') {
    const [row] = await db
      .select({
        imageUrl: episodes.imageUrl,
        ownerId: shows.userId,
        title: episodes.title,
        slug: episodes.slug,
        showSlug: shows.slug,
      })
      .from(episodes)
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .where(eq(episodes.id, id))
    return row
      ? { imageUrl: row.imageUrl, ownerId: row.ownerId, what: `the episode “${row.title}”`, path: episodePath(row.showSlug, row.slug) }
      : null
  }
  const [row] = await db.select({ image: users.image, name: users.name, slug: users.slug }).from(users).where(eq(users.id, id))
  return row ? { imageUrl: row.image, ownerId: id, what: `${row.name ?? row.slug}’s profile picture`, path: userPath(row.slug) } : null
}

// Takes the image off what was reported, if it's still the one reported.
async function clearImage(kind: ReportTargetKind, id: string, imageUrl: string) {
  if (kind === 'show') {
    await db.update(shows).set({ imageUrl: null }).where(and(eq(shows.id, id), eq(shows.imageUrl, imageUrl)))
  } else if (kind === 'episode') {
    await db.update(episodes).set({ imageUrl: null }).where(and(eq(episodes.id, id), eq(episodes.imageUrl, imageUrl)))
  } else {
    await db.update(users).set({ image: null }).where(and(eq(users.id, id), eq(users.image, imageUrl)))
  }
}

export type Reporter = { userId: string | null; ip: string | null; userAgent: string | null }

// Records a report of the image on `input.targetId`. False when there's no
// image there, or the visitor has already reported it today or reported too
// much. Admins are told the first time an image is reported for each reason.
export async function createReport(reporter: Reporter, input: ReportInput, now = new Date()) {
  const target = await findTarget(input.targetKind, input.targetId)
  if (!target?.imageUrl) return false
  const reporterHash = visitorHash(await saltFor(now.toISOString().slice(0, 10)), reporter.ip, reporter.userAgent)
  // Hashes change daily, so these are today's.
  const [reported] = await db
    .select({ value: count() })
    .from(contentReports)
    .where(eq(contentReports.reporterHash, reporterHash))
  if (reported!.value >= maxReportsPerDay) return false

  const sameImage = and(
    eq(contentReports.targetKind, input.targetKind),
    eq(contentReports.targetId, input.targetId),
    eq(contentReports.imageUrl, target.imageUrl),
    isNull(contentReports.resolvedAt),
  )
  const [earlier] = await db
    .select({ id: contentReports.id })
    .from(contentReports)
    .where(and(sameImage, eq(contentReports.reason, input.reason)))
    .limit(1)
  const inserted = await db
    .insert(contentReports)
    .values({
      targetKind: input.targetKind,
      targetId: input.targetId,
      imageUrl: target.imageUrl,
      ownerId: target.ownerId,
      reason: input.reason,
      details: input.details,
      reporterId: reporter.userId,
      reporterHash,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: contentReports.id })
  if (!inserted.length) return false
  if (!earlier) {
    void alertAdminsOfReport({ reason: input.reason, what: target.what }).catch((error: unknown) =>
      reportError(error, { msg: 'Alerting admins of a report failed', reportId: inserted[0]!.id }),
    )
  }
  return true
}

export type OpenReport = Awaited<ReturnType<typeof listOpenReports>>[number]

// The images with open reports, the most recently reported first, each with
// its reports. `current` is false once the image has been changed since.
export async function listOpenReports() {
  const rows = await db
    .select({
      id: contentReports.id,
      targetKind: contentReports.targetKind,
      targetId: contentReports.targetId,
      imageUrl: contentReports.imageUrl,
      reason: contentReports.reason,
      details: contentReports.details,
      createdAt: contentReports.createdAt,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(contentReports)
    .leftJoin(users, eq(users.id, contentReports.ownerId))
    .where(isNull(contentReports.resolvedAt))
    .orderBy(desc(contentReports.createdAt))

  const images = new Map<
    string,
    {
      reportId: string
      targetKind: ReportTargetKind
      imageUrl: string
      owner: string | null
      reports: { reason: ReportReason; details: string | null; createdAt: Date }[]
      targetId: string
    }
  >()
  for (const row of rows) {
    const key = `${row.targetKind}:${row.targetId}:${row.imageUrl}`
    let image = images.get(key)
    if (!image) {
      image = {
        reportId: row.id,
        targetKind: row.targetKind as ReportTargetKind,
        targetId: row.targetId,
        imageUrl: row.imageUrl,
        owner: row.ownerName ? `${row.ownerName} (${row.ownerEmail})` : row.ownerEmail,
        reports: [],
      }
      images.set(key, image)
    }
    image.reports.push({ reason: row.reason as ReportReason, details: row.details, createdAt: row.createdAt })
  }
  return Promise.all(
    [...images.values()].map(async (image) => {
      const target = await findTarget(image.targetKind, image.targetId)
      return {
        ...image,
        what: target?.what ?? 'something since deleted',
        path: target?.path ?? null,
        current: target?.imageUrl === image.imageUrl,
        childSafety: image.reports.some((report) => report.reason === 'childSafety'),
      }
    }),
  )
}

// Deals with the report, and every other open report of the same image. For
// 'removed' and 'preserved', the image is taken off what it was on. Returns
// whether Cloudflare's copy was purged (null when there's nothing to purge or
// no Cloudflare), or null when there was no such open report.
export async function resolveReport(adminId: string, reportId: string, resolution: ReportResolution, now = new Date()) {
  const [report] = await db
    .select()
    .from(contentReports)
    .where(and(eq(contentReports.id, reportId), isNull(contentReports.resolvedAt)))
  if (!report) return null
  const kind = report.targetKind as ReportTargetKind
  const sameImage = and(
    eq(contentReports.targetKind, report.targetKind),
    eq(contentReports.targetId, report.targetId),
    eq(contentReports.imageUrl, report.imageUrl),
    isNull(contentReports.resolvedAt),
  )

  let evidence: (typeof contentReports.$inferInsert)['evidence'] = null
  if (resolution === 'preserved') {
    // The copy is made before anything is deleted, and failing to make it stops here.
    const imageId = localImageUrl.exec(report.imageUrl)?.[1]
    if (imageId) {
      await ensureQuarantineDir()
      await copyFile(imagePath(imageId), quarantinePath(report.id))
    }
    const [owner] = report.ownerId
      ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, report.ownerId))
      : []
    const target = await findTarget(kind, report.targetId)
    evidence = {
      ownerId: report.ownerId,
      ownerName: owner?.name ?? null,
      ownerEmail: owner?.email ?? null,
      what: target?.what ?? `${kind} ${report.targetId}`,
    }
  }
  if (resolution !== 'dismissed') {
    await clearImage(kind, report.targetId, report.imageUrl)
    await deleteImage(report.imageUrl)
  }
  await db
    .update(contentReports)
    .set({ resolution, resolvedAt: now, resolvedById: adminId })
    .where(sameImage)
  if (evidence) await db.update(contentReports).set({ evidence }).where(eq(contentReports.id, report.id))
  return { purged: resolution === 'dismissed' ? null : await purgeFromCloudflare(report.imageUrl) }
}

// Overridable in tests.
export const cloudflare = {
  api: 'https://api.cloudflare.com/client/v4',
  zoneId: env.CLOUDFLARE_ZONE_ID,
  token: env.CLOUDFLARE_API_TOKEN,
}

// Purges a stored image, with all its sizes, from Cloudflare's cache. Images
// are cached for a year, so a removed one would otherwise go on being served
// there. Null when there's no Cloudflare (or the image wasn't stored here).
export async function purgeFromCloudflare(imageUrl: string) {
  const origin = siteOrigin()
  if (!cloudflare.zoneId || !cloudflare.token || !origin || !localImageUrl.test(imageUrl)) return null
  try {
    const response = await fetch(`${cloudflare.api}/zones/${cloudflare.zoneId}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cloudflare.token}`, 'Content-Type': 'application/json' },
      // By prefix, so every ?w= size goes too.
      body: JSON.stringify({ prefixes: [`${new URL(origin).host}${imageUrl}`] }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
    return true
  } catch (error) {
    reportError(error, { msg: 'Purging an image from Cloudflare failed', imageUrl })
    return false
  }
}
