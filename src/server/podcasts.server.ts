import '@tanstack/react-start/server-only'
import { and, asc, eq, like, or, sql } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, podcasts, users } from '~/server/db/schema'
import { plainTextToHtml } from '~/lib/rich-text'
import { firstFreeSlug, slugify } from '~/lib/slug'
import { commitImage, deleteImage } from '~/server/images.server'
import { sanitizeDescription } from '~/server/rich-text.server'
import type { EditPodcastInput, NewPodcastInput } from '~/lib/podcast-schema'

const summaryColumns = {
  id: podcasts.id,
  title: podcasts.title,
  slug: podcasts.slug,
  imageUrl: podcasts.imageUrl,
}

// The podcast's own artwork, or else its newest ready episode's, as on the podcast page.
const artwork = sql<string | null>`coalesce(${podcasts.imageUrl}, (
  select ${episodes.imageUrl} from ${episodes}
  where ${episodes.podcastId} = ${podcasts.id} and ${episodes.status} = 'ready' and ${episodes.imageUrl} is not null
  order by ${episodes.createdAt} desc
  limit 1
))`

// With when each was made and when its latest episode came out, so the
// sidebar can sort them (see src/lib/podcast-sort.ts). The join also makes
// drizzle qualify the columns in the artwork subquery.
export function listPodcasts(userId: string) {
  return db
    .select({
      ...summaryColumns,
      imageUrl: artwork,
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

// Any podcast, by slug, for its public page: null if there's no such podcast.
// Private podcasts are included, as they're unlisted rather than secret.
export async function getPublicPodcast(slug: string) {
  const [podcast] = await db
    .select({
      id: podcasts.id,
      userId: podcasts.userId,
      title: podcasts.title,
      slug: podcasts.slug,
      description: podcasts.description,
      imageUrl: artwork,
      category: podcasts.category,
      explicit: podcasts.explicit,
      private: podcasts.private,
      author: users.name,
    })
    .from(podcasts)
    .innerJoin(users, eq(users.id, podcasts.userId))
    .where(eq(podcasts.slug, slug))
    .limit(1)
  return podcast ?? null
}

// Slugs are unique across all users: "my-show", then "my-show-2", "my-show-3"…
async function availableSlug(title: string) {
  const base = slugify(title, 'podcast')
  const taken = await db
    .select({ slug: podcasts.slug })
    .from(podcasts)
    .where(or(eq(podcasts.slug, base), like(podcasts.slug, `${base}-%`)))
  return firstFreeSlug(base, new Set(taken.map((row) => row.slug)))
}

export async function createPodcast(userId: string, input: NewPodcastInput) {
  const slug = await availableSlug(input.title)
  const description = input.description ? plainTextToHtml(input.description) : undefined
  const values = { userId, title: input.title, description, slug }
  const [podcast] = await db.insert(podcasts).values(values).onConflictDoNothing().returning(summaryColumns)
  if (podcast) return podcast
  // Someone took the slug in the meantime; fall back to a random suffix.
  const suffix = crypto.randomUUID().slice(0, 6)
  const [retry] = await db
    .insert(podcasts)
    .values({ ...values, slug: `${slug}-${suffix}` })
    .returning(summaryColumns)
  return retry!
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
  await db
    .update(podcasts)
    .set({ title: input.title, description: sanitizeDescription(input.description), imageUrl })
    .where(eq(podcasts.id, podcast.id))
  if (imageUrl !== podcast.imageUrl) await deleteImage(podcast.imageUrl)
  return true
}
