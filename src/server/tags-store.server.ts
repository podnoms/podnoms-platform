import '@tanstack/react-start/server-only'
import { eq, ilike, inArray, like, or, sql } from 'drizzle-orm'
import { firstFreeSlug, slugify } from '~/lib/slug'
import { normalizeTagName, tagNamesSchema, type Tag } from '~/lib/tag-schema'
import { db } from '~/server/db/client.server'
import { episodes, episodeTags, shows, showTags, tags } from '~/server/db/schema'

export type TagTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Call after checking ownership, inside the transaction that creates or edits
// the show/episode. Locking the parent serialises simultaneous replacements.
export async function syncShowTags(tx: TagTransaction, showId: string, names: string[]) {
  await tx.select({ id: shows.id }).from(shows).where(eq(shows.id, showId)).for('update')
  const selected = await resolveTags(tx, names)
  await tx.delete(showTags).where(eq(showTags.showId, showId))
  if (selected.length) await tx.insert(showTags).values(selected.map(({ id: tagId }) => ({ showId, tagId })))
}

export async function syncEpisodeTags(tx: TagTransaction, episodeId: string, names: string[]) {
  await tx.select({ id: episodes.id }).from(episodes).where(eq(episodes.id, episodeId)).for('update')
  const selected = await resolveTags(tx, names)
  await tx.delete(episodeTags).where(eq(episodeTags.episodeId, episodeId))
  if (selected.length) await tx.insert(episodeTags).values(selected.map(({ id: tagId }) => ({ episodeId, tagId })))
}

async function resolveTags(tx: TagTransaction, names: string[]): Promise<Tag[]> {
  const normalised = tagNamesSchema.parse(names).sort()
  if (!normalised.length) return []
  const existing = await tx.select().from(tags).where(inArray(sql`lower(${tags.name})`, normalised))
  const byName = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag]))
  // Create in name order to keep overlapping sets from locking in reverse
  // order. Names may share a slug ("deep house" and "deep-house"), so number
  // collisions while keeping the tag name's own unique identity.
  for (const name of normalised) {
    if (byName.has(name)) continue
    const base = slugify(name, 'tag')
    const occupied = await tx.select({ slug: tags.slug }).from(tags)
      .where(or(eq(tags.slug, base), like(tags.slug, `${base}-%`)))
    const taken = new Set(occupied.map((tag) => tag.slug))
    for (;;) {
      const slug = firstFreeSlug(base, taken)
      const [created] = await tx.insert(tags).values({ name, slug }).onConflictDoNothing().returning()
      if (created) {
        byName.set(name, created)
        break
      }
      // A concurrent request may have created this name or claimed its slug.
      // ON CONFLICT keeps the transaction usable in either case.
      const [shared] = await tx.select().from(tags).where(eq(sql`lower(${tags.name})`, name)).limit(1)
      if (shared) {
        byName.set(name, shared)
        break
      }
      taken.add(slug)
    }
  }
  return normalised.map((name) => byName.get(name)!)
}

export async function getTag(tagId: string): Promise<Tag | null> {
  const [tag] = await db.select().from(tags).where(eq(tags.id, tagId)).limit(1)
  return tag ?? null
}

export async function getTagBySlug(slug: string): Promise<Tag | null> {
  const [tag] = await db.select().from(tags).where(eq(tags.slug, slug)).limit(1)
  return tag ?? null
}

// Entity reads are internal helpers: their callers first enforce the show's
// or episode's visibility. Suggestions share names, never private content.
export function getShowTags(showId: string): Promise<Tag[]> {
  return db.select({ id: tags.id, name: tags.name, slug: tags.slug }).from(tags)
    .innerJoin(showTags, eq(showTags.tagId, tags.id))
    .where(eq(showTags.showId, showId)).orderBy(tags.name)
}

export function getEpisodeTags(episodeId: string): Promise<Tag[]> {
  return db.select({ id: tags.id, name: tags.name, slug: tags.slug }).from(tags)
    .innerJoin(episodeTags, eq(episodeTags.tagId, tags.id))
    .where(eq(episodeTags.episodeId, episodeId)).orderBy(tags.name)
}

// Add direct episode tags to a page in one query, preserving its order. Show
// tags are inherited for discovery and displayed on the show's own page.
export async function withEpisodeTags<T extends { id: string }>(rows: T[]): Promise<(T & { tags: Tag[] })[]> {
  if (!rows.length) return []
  const links = await db.select({ episodeId: episodeTags.episodeId, id: tags.id, name: tags.name, slug: tags.slug })
    .from(episodeTags).innerJoin(tags, eq(tags.id, episodeTags.tagId))
    .where(inArray(episodeTags.episodeId, rows.map(({ id }) => id))).orderBy(tags.name)
  const byEpisode = new Map<string, Tag[]>()
  for (const { episodeId, id, name, slug } of links) {
    const found = byEpisode.get(episodeId) ?? []
    found.push({ id, name, slug })
    byEpisode.set(episodeId, found)
  }
  return rows.map((row) => ({ ...row, tags: byEpisode.get(row.id) ?? [] }))
}

export async function searchTags(query: string): Promise<Tag[]> {
  const value = normalizeTagName(query).slice(0, 50)
  const literal = value.replace(/[\\%_]/g, '\\$&')
  const prefix = `${literal}%`
  return db.select().from(tags).where(ilike(tags.name, `%${literal}%`))
    .orderBy(sql`case when ${tags.name} ilike ${prefix} then 0 else 1 end`, tags.name)
    .limit(12)
}

