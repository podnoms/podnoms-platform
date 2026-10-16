import '@tanstack/react-start/server-only'
import { and, asc, eq, like, or, sql } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, podcastFollows, podcasts, users } from '~/server/db/schema'
import { reservedPodcastSlugs } from '~/lib/paths'
import { plainTextToHtml } from '~/lib/rich-text'
import { firstFreeSlug, slugify } from '~/lib/slug'
import { customDomainValues, withDomainConflict } from '~/server/custom-domains.server'
import { commitImage, deleteImage } from '~/server/images.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import { syncPodcastTags } from '~/server/tags-store.server'
import type { DirectoryLinks } from '~/lib/podcast-directories'
import type { DirectoryDetailsInput, DirectoryLinkInput, EditPodcastInput, NewPodcastInput } from '~/lib/podcast-schema'

const summaryColumns = {
  id: podcasts.id,
  title: podcasts.title,
  slug: podcasts.slug,
  imageUrl: podcasts.imageUrl,
}

// Who makes the podcast: as its owner says on the Distribution tab, or else
// the owner's name. Needs the user table joined.
export const podcastAuthor = sql<string | null>`coalesce(${podcasts.author}, ${users.name})`

// The podcast's own artwork, or else its newest ready episode's, as on the
// podcast page. Private episodes' artwork isn't used, as listeners see it.
export const podcastArtwork = sql<string | null>`coalesce(${podcasts.imageUrl}, (
  select ${episodes.imageUrl} from ${episodes}
  where ${episodes.podcastId} = ${podcasts.id} and ${episodes.status} = 'ready' and ${episodes.imageUrl} is not null
    and not ${episodes.private}
  order by ${episodes.createdAt} desc
  limit 1
))`

// How many follow the podcast, and whether the viewer (if signed in) does.
// In a query with a join, so drizzle qualifies the podcast's id.
export function podcastFollowColumns(viewerId: string | null) {
  return {
    followerCount: sql<number>`(
      select count(*) from ${podcastFollows} where ${podcastFollows.podcastId} = ${podcasts.id}
    )`.mapWith(Number),
    following: (viewerId
      ? sql<boolean>`exists (
          select 1 from ${podcastFollows} where ${podcastFollows.podcastId} = ${podcasts.id} and ${podcastFollows.userId} = ${viewerId}
        )`
      : sql<boolean>`false`
    ).mapWith(Boolean),
  }
}

// With when each was made and when its latest episode came out, so the
// sidebar can sort them (see src/lib/podcast-sort.ts). The join also makes
// drizzle qualify the columns in the artwork subquery.
export function listPodcasts(userId: string) {
  return db
    .select({
      ...summaryColumns,
      imageUrl: podcastArtwork,
      createdAt: podcasts.createdAt,
      latestEpisodeAt: sql`max(coalesce(${episodes.publishedAt}, ${episodes.createdAt}))`.mapWith(podcasts.createdAt),
    })
    .from(podcasts)
    .leftJoin(episodes, and(eq(episodes.podcastId, podcasts.id), eq(episodes.status, 'ready')))
    .where(eq(podcasts.userId, userId))
    .groupBy(podcasts.id)
    .orderBy(asc(podcasts.title))
}

export async function getPodcastBySlug(userId: string, slug: string) {
  const [podcast] = await db
    .select()
    .from(podcasts)
    .where(and(eq(podcasts.userId, userId), eq(podcasts.slug, slug)))
    .limit(1)
  return podcast ?? null
}

// A podcast, by slug, for its public page: null if there's no such podcast,
// or it's private and the viewer isn't its owner.
export async function getPublicPodcast(slug: string, viewerId: string | null) {
  const [podcast] = await db
    .select({
      id: podcasts.id,
      userId: podcasts.userId,
      title: podcasts.title,
      slug: podcasts.slug,
      description: podcasts.description,
      imageUrl: podcastArtwork,
      category: podcasts.category,
      explicit: podcasts.explicit,
      private: podcasts.private,
      feedKey: podcasts.feedKey,
      author: podcastAuthor,
      directoryLinks: podcasts.directoryLinks,
      ...podcastFollowColumns(viewerId),
    })
    .from(podcasts)
    .innerJoin(users, eq(users.id, podcasts.userId))
    .where(
      and(
        eq(podcasts.slug, slug),
        viewerId ? or(eq(podcasts.private, false), eq(podcasts.userId, viewerId)) : eq(podcasts.private, false),
      ),
    )
    .limit(1)
  return podcast ?? null
}

// A private podcast's feed key, which its feed and audio URLs carry.
export function randomFeedKey() {
  return crypto.randomUUID().replaceAll('-', '')
}

// Makes a podcast private, with a feed key if it hasn't one yet (so the links
// listeners were given keep working if it's made private again), or public.
// Returns false unless the podcast belongs to the user.
export async function setPodcastPrivacy(userId: string, podcastId: string, isPrivate: boolean) {
  const updated = await db
    .update(podcasts)
    .set({ private: isPrivate, ...(isPrivate && { feedKey: sql`coalesce(${podcasts.feedKey}, ${randomFeedKey()})` }) })
    .where(and(eq(podcasts.id, podcastId), eq(podcasts.userId, userId)))
    .returning({ id: podcasts.id })
  return updated.length > 0
}

// Gives a private podcast a new feed key, so the old feed URL (and the audio
// links in it) stop working. Returns false unless the podcast is the user's
// and private.
export async function resetFeedKey(userId: string, podcastId: string) {
  const updated = await db
    .update(podcasts)
    .set({ feedKey: randomFeedKey() })
    .where(and(eq(podcasts.id, podcastId), eq(podcasts.userId, userId), eq(podcasts.private, true)))
    .returning({ id: podcasts.id })
  return updated.length > 0
}

// Slugs are unique across all users: "my-show", then "my-show-2", "my-show-3"…
// The site's own top-level paths count as taken, as podcasts are served there.
async function availableSlug(title: string) {
  const base = slugify(title, 'podcast')
  const taken = await db
    .select({ slug: podcasts.slug })
    .from(podcasts)
    .where(or(eq(podcasts.slug, base), like(podcasts.slug, `${base}-%`)))
  return firstFreeSlug(base, new Set([...reservedPodcastSlugs, ...taken.map((row) => row.slug)]))
}

export async function createPodcast(userId: string, input: NewPodcastInput) {
  const slug = await availableSlug(input.title)
  const description = input.description ? plainTextToHtml(input.description) : undefined
  // Its own domain, if one was given, is checked later from the Distribution tab.
  const domain = input.customDomain ? customDomainValues(input.customDomain) : {}
  const values = { userId, title: input.title, description, slug, ...domain }
  return withDomainConflict(() => db.transaction(async (tx) => {
    const [podcast] = await tx
      .insert(podcasts)
      .values(values)
      .onConflictDoNothing({ target: podcasts.slug })
      .returning(summaryColumns)
    if (podcast) {
      if (input.tags !== undefined) await syncPodcastTags(tx, podcast.id, input.tags)
      return podcast
    }
    // Someone took the slug in the meantime; fall back to a random suffix.
    const suffix = crypto.randomUUID().slice(0, 6)
    const [retry] = await tx
      .insert(podcasts)
      .values({ ...values, slug: `${slug}-${suffix}` })
      .returning(summaryColumns)
    if (input.tags !== undefined) await syncPodcastTags(tx, retry!.id, input.tags)
    return retry!
  }))
}

// Returns false unless the podcast belongs to the user. The slug (and so the
// feed URL) stays the same when the title changes.
export async function updatePodcast(userId: string, input: EditPodcastInput) {
  const [podcast] = await db
    .select({ id: podcasts.id, imageUrl: podcasts.imageUrl })
    .from(podcasts)
    .where(and(eq(podcasts.id, input.id), eq(podcasts.userId, userId)))
    .limit(1)
  if (!podcast) return false
  const imageUrl =
    input.imageId === undefined ? podcast.imageUrl : input.imageId ? await commitImage(userId, input.imageId) : null
  await db.transaction(async (tx) => {
    await tx
      .update(podcasts)
      .set({ title: input.title, description: sanitizeDescription(input.description), imageUrl })
      .where(eq(podcasts.id, podcast.id))
    if (input.tags !== undefined) await syncPodcastTags(tx, podcast.id, input.tags)
  })
  if (imageUrl !== podcast.imageUrl) await deleteImage(podcast.imageUrl)
  return true
}

// Saves what directories need to know: category, language, who makes it and
// the owner email they confirm ownership with. Returns false unless the
// podcast belongs to the user.
export async function updateDirectoryDetails(userId: string, input: DirectoryDetailsInput) {
  const { id, ...details } = input
  const updated = await db
    .update(podcasts)
    .set(details)
    .where(and(eq(podcasts.id, id), eq(podcasts.userId, userId)))
    .returning({ id: podcasts.id })
  return updated.length > 0
}

// Remembers (or, given an empty link, forgets) the podcast's listing on a
// directory. Returns false unless the podcast belongs to the user.
export async function updateDirectoryLink(userId: string, input: DirectoryLinkInput) {
  const [podcast] = await db
    .select({ directoryLinks: podcasts.directoryLinks })
    .from(podcasts)
    .where(and(eq(podcasts.id, input.id), eq(podcasts.userId, userId)))
    .limit(1)
  if (!podcast) return false
  const { [input.directory]: _previous, ...others } = podcast.directoryLinks
  const directoryLinks: DirectoryLinks = input.link ? { ...others, [input.directory]: input.link } : others
  await db.update(podcasts).set({ directoryLinks }).where(eq(podcasts.id, input.id))
  return true
}
