import '@tanstack/react-start/server-only'
import { and, asc, eq, like, or } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { podcasts } from '~/server/db/schema'
import type { NewPodcastInput } from '~/lib/podcast-schema'

const summaryColumns = {
  id: podcasts.id,
  title: podcasts.title,
  slug: podcasts.slug,
  imageUrl: podcasts.imageUrl,
}

export function listPodcasts(userId: string) {
  return db.select(summaryColumns).from(podcasts).where(eq(podcasts.userId, userId)).orderBy(asc(podcasts.title))
}

export async function getPodcastBySlug(userId: string, slug: string) {
  const [podcast] = await db
    .select()
    .from(podcasts)
    .where(and(eq(podcasts.userId, userId), eq(podcasts.slug, slug)))
    .limit(1)
  return podcast ?? null
}

function slugify(title: string) {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'podcast'
}

// Slugs are unique across all users: "my-show", then "my-show-2", "my-show-3"…
async function availableSlug(title: string) {
  const base = slugify(title)
  const taken = new Set(
    (
      await db
        .select({ slug: podcasts.slug })
        .from(podcasts)
        .where(or(eq(podcasts.slug, base), like(podcasts.slug, `${base}-%`)))
    ).map((row) => row.slug),
  )
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

export async function createPodcast(userId: string, input: NewPodcastInput) {
  const slug = await availableSlug(input.title)
  const values = { userId, title: input.title, description: input.description, slug }
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
