import '@tanstack/react-start/server-only'
import { and, asc, eq, like, ne, or, sql } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, showFollows, shows, users } from '~/server/db/schema'
import { reservedShowSlugs } from '~/lib/paths'
import { plainTextToHtml } from '~/lib/rich-text'
import { firstFreeSlug, slugify } from '~/lib/slug'
import { customDomainValues, withDomainConflict } from '~/server/custom-domains.server'
import { commitImage, deleteImage } from '~/server/images.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { syncShowTags } from '~/server/tags-store.server'
import type { DirectoryLinks } from '~/lib/podcast-directories'
import type { DirectoryDetailsInput, DirectoryLinkInput, EditShowInput, NewShowInput } from '~/lib/show-schema'

const summaryColumns = {
  id: shows.id,
  title: shows.title,
  slug: shows.slug,
  imageUrl: shows.imageUrl,
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
      imageUrl: showArtwork,
      createdAt: shows.createdAt,
      latestEpisodeAt: sql`max(coalesce(${episodes.publishedAt}, ${episodes.createdAt}))`.mapWith(shows.createdAt),
    })
    .from(shows)
    .leftJoin(episodes, and(eq(episodes.showId, shows.id), eq(episodes.status, 'ready')))
    .where(eq(shows.userId, userId))
    .groupBy(shows.id)
    .orderBy(asc(shows.title))
}

export async function getShowBySlug(userId: string, slug: string) {
  const [show] = await db
    .select()
    .from(shows)
    .where(and(eq(shows.userId, userId), eq(shows.slug, slug)))
    .limit(1)
  return show ?? null
}

// A show, by slug, for its public page: null if there's no such show,
// or it's private and the viewer isn't its owner.
export async function getPublicShow(slug: string, viewerId: string | null) {
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
      ...showFollowColumns(viewerId),
    })
    .from(shows)
    .innerJoin(users, eq(users.id, shows.userId))
    .where(
      and(
        eq(shows.slug, slug),
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
  const updated = await db
    .update(shows)
    .set({ private: isPrivate, ...(isPrivate && { feedKey: sql`coalesce(${shows.feedKey}, ${randomFeedKey()})` }) })
    .where(and(eq(shows.id, showId), eq(shows.userId, userId)))
    .returning({ id: shows.id })
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

// Slugs are unique across all users: "my-show", then "my-show-2", "my-show-3"…
// The site's own top-level paths count as taken, as shows are served there.
async function availableSlug(title: string) {
  const base = slugify(title, 'show')
  const taken = await db
    .select({ slug: shows.slug })
    .from(shows)
    .where(or(eq(shows.slug, base), like(shows.slug, `${base}-%`)))
  return firstFreeSlug(base, new Set([...reservedShowSlugs, ...taken.map((row) => row.slug)]))
}

export async function createShow(userId: string, input: NewShowInput) {
  const slug = await availableSlug(input.title)
  const description = input.description ? plainTextToHtml(input.description) : undefined
  // Its own domain, if one was given, is checked later from the Distribution tab.
  const domain = input.customDomain ? customDomainValues(input.customDomain) : {}
  const values = { userId, title: input.title, description, slug, ...domain }
  return withDomainConflict(() => db.transaction(async (tx) => {
    const [show] = await tx
      .insert(shows)
      .values(values)
      .onConflictDoNothing({ target: shows.slug })
      .returning(summaryColumns)
    if (show) {
      if (input.tags !== undefined) await syncShowTags(tx, show.id, input.tags)
      return show
    }
    // Someone took the slug in the meantime; fall back to a random suffix.
    const suffix = crypto.randomUUID().slice(0, 6)
    const [retry] = await tx
      .insert(shows)
      .values({ ...values, slug: `${slug}-${suffix}` })
      .returning(summaryColumns)
    if (input.tags !== undefined) await syncShowTags(tx, retry!.id, input.tags)
    return retry!
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
  return code === '23505' && constraint_name === 'show_slug_unique'
}

// Returns false unless the show belongs to the user. The slug (and so the
// feed URL) stays the same when the title changes, and only changes when a
// new one is given; throws a ShowSlugError if another show has it.
export async function updateShow(userId: string, input: EditShowInput) {
  const [show] = await db
    .select({ id: shows.id, imageUrl: shows.imageUrl })
    .from(shows)
    .where(and(eq(shows.id, input.id), eq(shows.userId, userId)))
    .limit(1)
  if (!show) return false
  // Checked before the image is kept, so a refusal leaves nothing behind.
  if (input.slug) {
    const [other] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(and(eq(shows.slug, input.slug), ne(shows.id, show.id)))
      .limit(1)
    if (other) throw slugTaken()
  }
  const imageUrl =
    input.imageId === undefined ? show.imageUrl : input.imageId ? await commitImage(userId, input.imageId) : null
  await db.transaction(async (tx) => {
    await tx
      .update(shows)
      .set({ title: input.title, description: sanitizeDescription(input.description), imageUrl, ...(input.slug && { slug: input.slug }) })
      .where(eq(shows.id, show.id))
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
