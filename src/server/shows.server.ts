import '@tanstack/react-start/server-only'
import { and, asc, eq, like, ne, or, sql } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, showFollows, showSlugAliases, shows, userSlugAliases, users } from '~/server/db/schema'
import { reservedShowSlugs, type ShowRef } from '~/lib/paths'
import { newPodcastGuid } from '~/server/podcast-guid.server'
import { plainTextToHtml } from '~/lib/rich-text'
import { firstFreeSlug, slugify } from '~/lib/slug'
import { customDomainValues, withDomainConflict } from '~/server/custom-domains.server'
import { hasPaidAccess, requirePaidAccess } from '~/server/subscriptions.server'
import { moveHlsVersions } from '~/server/hls.server'
import { themeAssets } from '~/lib/theme-css'
import type { SiteTheme } from '~/lib/theme-schema'
import { commitImage, deleteImage } from '~/server/images.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { syncShowTags } from '~/server/tags-store.server'
import type { DirectoryLinks } from '~/lib/podcast-directories'
import type { DirectoryDetailsInput, DirectoryLinkInput, EditShowInput, NewShowInput, ShowThemeInput } from '~/lib/show-schema'
import { prepareTheme } from '~/server/themes.server'

const summaryColumns = {
  id: shows.id,
  title: shows.title,
  slug: shows.slug,
  imageUrl: shows.imageUrl,
}

// What a show's address needs (a ShowRef, see src/lib/paths.ts). Needs the
// user table joined.
export const showRefColumns = { slug: shows.slug, ownerSlug: users.slug }

// A show, by id or by address. Needs the user table joined.
export type ShowKey = { id: string } | ShowRef

export function showWhere(key: ShowKey) {
  return 'id' in key ? eq(shows.id, key.id) : and(eq(users.slug, key.ownerSlug), eq(shows.slug, key.slug))
}

// Where a show that was at `ref` is now, if its owner or it has had another
// slug since (see userSlugAliases, showSlugAliases), so its old addresses
// can redirect; null if there's nothing there. Privacy is left to the page
// redirected to.
export async function movedShow(ref: ShowRef): Promise<ShowRef | null> {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.slug, ref.ownerSlug))
    .unionAll(db.select({ id: userSlugAliases.userId }).from(userSlugAliases).where(eq(userSlugAliases.slug, ref.ownerSlug)))
    .limit(1)
  if (!owner) return null
  const [show] = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.userId, owner.id), eq(shows.slug, ref.slug)))
    .unionAll(
      db
        .select({ id: showSlugAliases.showId })
        .from(showSlugAliases)
        .where(and(eq(showSlugAliases.userId, owner.id), eq(showSlugAliases.slug, ref.slug))),
    )
    .limit(1)
  if (!show) return null
  const [now] = await db
    .select(showRefColumns)
    .from(shows)
    .innerJoin(users, eq(users.id, shows.userId))
    .where(eq(shows.id, show.id))
    .limit(1)
  return now && (now.ownerSlug !== ref.ownerSlug || now.slug !== ref.slug) ? now : null
}

// Who makes the show: as its owner says on the Distribution tab, or else
// the owner's name. Needs the user table joined.
export const showAuthor = sql<string | null>`coalesce(${shows.author}, ${users.name})`

// The show's own artwork, or else its newest ready episode's, as on the
// show page. Private episodes' artwork isn't used, as listeners see it.
export const showArtwork = sql<string | null>`coalesce(${shows.imageUrl}, (
  select ${episodes.imageUrl} from ${episodes}
  where ${episodes.showId} = ${shows.id} and ${episodes.status} = 'ready' and ${episodes.imageUrl} is not null
    and not ${episodes.private}
  order by ${episodes.createdAt} desc
  limit 1
))`

// How many follow the show, and whether the viewer (if signed in) does.
// In a query with a join, so drizzle qualifies the show's id.
export function showFollowColumns(viewerId: string | null) {
  return {
    followerCount: sql<number>`(
      select count(*) from ${showFollows} where ${showFollows.showId} = ${shows.id}
    )`.mapWith(Number),
    following: (viewerId
      ? sql<boolean>`exists (
          select 1 from ${showFollows} where ${showFollows.showId} = ${shows.id} and ${showFollows.userId} = ${viewerId}
        )`
      : sql<boolean>`false`
    ).mapWith(Boolean),
  }
}

// With when each was made and when its latest episode came out, so the
// sidebar can sort them (see src/lib/show-sort.ts). The join also makes
// drizzle qualify the columns in the artwork subquery.
export function listShows(userId: string) {
  return db
    .select({
      ...summaryColumns,
      ownerSlug: users.slug,
      imageUrl: showArtwork,
      createdAt: shows.createdAt,
      latestEpisodeAt: sql`max(coalesce(${episodes.publishedAt}, ${episodes.createdAt}))`.mapWith(shows.createdAt),
    })
    .from(shows)
    .innerJoin(users, eq(users.id, shows.userId))
    .leftJoin(episodes, and(eq(episodes.showId, shows.id), eq(episodes.status, 'ready')))
    .where(eq(shows.userId, userId))
    .groupBy(shows.id, users.slug)
    .orderBy(asc(shows.title))
}

export async function ownsShow(userId: string, showId: string) {
  const [show] = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.id, showId), eq(shows.userId, userId)))
    .limit(1)
  return Boolean(show)
}

export async function getShowBySlug(userId: string, slug: string) {
  const [show] = await db
    .select()
    .from(shows)
    .where(and(eq(shows.userId, userId), eq(shows.slug, slug)))
    .limit(1)
  return show ?? null
}

// A show, by id or address, for its public page: null if there's no such
// show, or it's private and the viewer isn't its owner.
export async function getPublicShow(key: ShowKey, viewerId: string | null) {
  const [show] = await db
    .select({
      id: shows.id,
      userId: shows.userId,
      title: shows.title,
      slug: shows.slug,
      description: shows.description,
      imageUrl: showArtwork,
      category: shows.category,
      explicit: shows.explicit,
      private: shows.private,
      feedKey: shows.feedKey,
      author: showAuthor,
      // The owner's profile, which the author's name links to.
      ownerSlug: users.slug,
      directoryLinks: shows.directoryLinks,
      theme: shows.theme,
      ...showFollowColumns(viewerId),
    })
    .from(shows)
    .innerJoin(users, eq(users.id, shows.userId))
    .where(
      and(
        showWhere(key),
        viewerId ? or(eq(shows.private, false), eq(shows.userId, viewerId)) : eq(shows.private, false),
      ),
    )
    .limit(1)
  return show ?? null
}

// A private show's feed key, which its feed and audio URLs carry.
export function randomFeedKey() {
  return crypto.randomUUID().replaceAll('-', '')
}

// Makes a show private, with a feed key if it hasn't one yet (so the links
// listeners were given keep working if it's made private again), or public.
// Returns false unless the show belongs to the user.
export async function setShowPrivacy(userId: string, showId: string, isPrivate: boolean) {
  if (isPrivate) await requirePaidAccess(userId, 'privateShows')
  const updated = await db
    .update(shows)
    .set({ private: isPrivate, ...(isPrivate && { feedKey: sql`coalesce(${shows.feedKey}, ${randomFeedKey()})` }) })
    .where(and(eq(shows.id, showId), eq(shows.userId, userId)))
    .returning({ id: shows.id })
  // Its episodes' streams' public URLs stop working (see hls.server.ts).
  if (isPrivate && updated.length) {
    const rows = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.showId, showId))
    await moveHlsVersions(rows.map((row) => row.id))
  }
  return updated.length > 0
}

// Gives a private show a new feed key, so the old feed URL (and the audio
// links in it) stop working. Returns false unless the show is the user's
// and private.
export async function resetFeedKey(userId: string, showId: string) {
  const updated = await db
    .update(shows)
    .set({ feedKey: randomFeedKey() })
    .where(and(eq(shows.id, showId), eq(shows.userId, userId), eq(shows.private, true)))
    .returning({ id: shows.id })
  return updated.length > 0
}

// Slugs are unique per owner: "my-show", then "my-show-2", "my-show-3"…
// The paths under a user count as taken, as their shows are served there,
// and so do the owner's shows' old slugs, which redirect.
async function availableSlug(userId: string, title: string) {
  const base = slugify(title, 'show')
  const similar = (column: typeof shows.slug | typeof showSlugAliases.slug) => or(eq(column, base), like(column, `${base}-%`))
  const taken = await db
    .select({ slug: shows.slug })
    .from(shows)
    .where(and(eq(shows.userId, userId), similar(shows.slug)))
    .unionAll(
      db
        .select({ slug: showSlugAliases.slug })
        .from(showSlugAliases)
        .where(and(eq(showSlugAliases.userId, userId), similar(showSlugAliases.slug))),
    )
  return firstFreeSlug(base, new Set([...reservedShowSlugs, ...taken.map((row) => row.slug)]))
}

async function ownerSlug(userId: string) {
  const [owner] = await db.select({ slug: users.slug }).from(users).where(eq(users.id, userId)).limit(1)
  if (!owner) throw new Error(`No user ${userId}`)
  return owner.slug
}

export async function createShow(userId: string, input: NewShowInput) {
  const [slug, owner] = await Promise.all([availableSlug(userId, input.title), ownerSlug(userId)])
  const description = input.description ? plainTextToHtml(input.description) : undefined
  if (input.customDomain) await requirePaidAccess(userId, 'customDomain')
  // Its own domain, if one was given, is checked later from the Custom domain tab.
  const domain = input.customDomain ? customDomainValues(input.customDomain) : {}
  const values = { userId, title: input.title, description, ...domain }
  const insert = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], slug: string) =>
    tx
      .insert(shows)
      .values({ ...values, slug, podcastGuid: newPodcastGuid({ ownerSlug: owner, slug }) })
      .onConflictDoNothing({ target: [shows.userId, shows.slug] })
      .returning(summaryColumns)
  return withDomainConflict(() => db.transaction(async (tx) => {
    // If they made another with the slug in the meantime, fall back to a
    // random suffix.
    const [first] = await insert(tx, slug)
    const show = first ?? (await insert(tx, `${slug}-${crypto.randomUUID().slice(0, 6)}`))[0]!
    if (input.tags !== undefined) await syncShowTags(tx, show.id, input.tags)
    return { ...show, ownerSlug: owner }
  }))
}

// Thrown when a show can't have the slug asked for, with why, for the form.
export class ShowSlugError extends Error {
  override name = 'ShowSlugError'
}

const slugTaken = () => new ShowSlugError('That address is taken. Try another.')

function isShowSlugConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  // Drizzle wraps the database's error in its own.
  if ('cause' in error && isShowSlugConflict(error.cause)) return true
  const { code, constraint_name } = error as { code?: string; constraint_name?: string }
  return code === '23505' && constraint_name === 'show_userId_slug_idx'
}

// Returns false unless the show belongs to the user. The slug (and so the
// feed URL) stays the same when the title changes, and only changes when a
// new one is given; throws a ShowSlugError if another of the owner's shows
// has it, or had it. The old one then redirects to the new one.
export async function updateShow(userId: string, input: EditShowInput) {
  const [show] = await db
    .select({ id: shows.id, imageUrl: shows.imageUrl, slug: shows.slug })
    .from(shows)
    .where(and(eq(shows.id, input.id), eq(shows.userId, userId)))
    .limit(1)
  if (!show) return false
  const newSlug = input.slug && input.slug !== show.slug ? input.slug : null
  // Checked before the image is kept, so a refusal leaves nothing behind.
  if (newSlug) {
    const [other] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(and(eq(shows.userId, userId), eq(shows.slug, newSlug), ne(shows.id, show.id)))
      .unionAll(
        db
          .select({ id: showSlugAliases.showId })
          .from(showSlugAliases)
          .where(and(eq(showSlugAliases.userId, userId), eq(showSlugAliases.slug, newSlug), ne(showSlugAliases.showId, show.id))),
      )
      .limit(1)
    if (other) throw slugTaken()
  }
  const imageUrl =
    input.imageId === undefined ? show.imageUrl : input.imageId ? await commitImage(userId, input.imageId) : null
  await db.transaction(async (tx) => {
    await tx
      .update(shows)
      .set({ title: input.title, description: sanitizeDescription(input.description), imageUrl, ...(newSlug && { slug: newSlug }) })
      .where(eq(shows.id, show.id))
    if (newSlug) {
      // Its old address redirects here; going back to a slug it had before
      // just takes that one back.
      await tx.delete(showSlugAliases).where(and(eq(showSlugAliases.userId, userId), eq(showSlugAliases.slug, newSlug)))
      await tx
        .insert(showSlugAliases)
        .values({ userId, slug: show.slug, showId: show.id })
        .onConflictDoUpdate({ target: [showSlugAliases.userId, showSlugAliases.slug], set: { showId: show.id } })
    }
    if (input.tags !== undefined) await syncShowTags(tx, show.id, input.tags)
  }).catch((error: unknown) => {
    // Taken by another show meanwhile.
    throw isShowSlugConflict(error) ? slugTaken() : error
  })
  if (imageUrl !== show.imageUrl) await deleteImage(show.imageUrl)
  return true
}

// Saves what directories need to know: category, language, who makes it and
// the owner email they confirm ownership with. Returns false unless the
// show belongs to the user.
export async function updateDirectoryDetails(userId: string, input: DirectoryDetailsInput) {
  const { id, ...details } = input
  const updated = await db
    .update(shows)
    .set(details)
    .where(and(eq(shows.id, id), eq(shows.userId, userId)))
    .returning({ id: shows.id })
  return updated.length > 0
}

// Gives the show's public pages a theme (a paid feature), or (null) the
// site's again. Returns false unless the show belongs to the user.
export async function updateShowTheme(userId: string, input: ShowThemeInput) {
  if (input.theme) await requirePaidAccess(userId, 'showThemes')
  const theme = await prepareTheme(input.theme)
  const updated = await db
    .update(shows)
    .set({ theme })
    .where(and(eq(shows.id, input.id), eq(shows.userId, userId)))
    .returning({ id: shows.id })
  return updated.length > 0
}

// The show's theme as its public pages use it (themeAssets), or null: without
// one, or once its owner no longer has paid access, when it's kept but the
// site's is used instead.
export async function servedShowTheme(ownerId: string, theme: SiteTheme | null) {
  if (!theme || !(await hasPaidAccess(ownerId))) return null
  return themeAssets(theme, { over: 'site' })
}

// Remembers (or, given an empty link, forgets) the show's listing on a
// directory. Returns false unless the show belongs to the user.
export async function updateDirectoryLink(userId: string, input: DirectoryLinkInput) {
  const [show] = await db
    .select({ directoryLinks: shows.directoryLinks })
    .from(shows)
    .where(and(eq(shows.id, input.id), eq(shows.userId, userId)))
    .limit(1)
  if (!show) return false
  const { [input.directory]: _previous, ...others } = show.directoryLinks
  const directoryLinks: DirectoryLinks = input.link ? { ...others, [input.directory]: input.link } : others
  await db.update(shows).set({ directoryLinks }).where(eq(shows.id, input.id))
  return true
}
