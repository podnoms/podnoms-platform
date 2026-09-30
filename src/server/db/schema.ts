// Database schema. The users, accounts, sessions and verificationTokens tables
// follow the shape @auth/drizzle-adapter expects; `passwordHash` is an extra
// column for email/password sign-in.
import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from '@auth/core/adapters'

export const users = pgTable(
  'user',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name'),
    email: text('email').unique(),
    emailVerified: timestamp('emailVerified', { mode: 'date' }),
    image: text('image'),
    // Set only for users who registered with an email and password.
    passwordHash: text('passwordHash'),
  },
  // Emails are unique regardless of case, across OAuth and password users.
  (table) => [uniqueIndex('user_email_lower_idx').on(sql`lower(${table.email})`)],
)

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
)

// Unused while sessions are JWTs (required for email/password sign-in), but
// the adapter expects it to exist.
export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
)

// --- Podcasts ---------------------------------------------------------------

const timestamps = {
  createdAt: timestamp('createdAt', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

// A podcast (feed) owned by a user.
export const podcasts = pgTable(
  'podcast',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // Used in the podcast's public URL, so unique across all users.
    slug: text('slug').notNull().unique(),
    description: text('description'),
    imageUrl: text('imageUrl'),
    category: text('category'),
    language: text('language').notNull().default('en'),
    explicit: boolean('explicit').notNull().default(false),
    // Private podcasts aren't listed publicly; their feed is only reachable by URL.
    private: boolean('private').notNull().default(false),
    customDomain: text('customDomain').unique(),
    ...timestamps,
  },
  (table) => [index('podcast_userId_idx').on(table.userId)],
)

export const episodeStatus = pgEnum('episode_status', ['pending', 'processing', 'ready', 'failed'])

// An episode in a podcast, usually imported from a source such as a YouTube
// video or a Mixcloud/SoundCloud upload.
export const episodes = pgTable(
  'episode',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    podcastId: text('podcastId')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    imageUrl: text('imageUrl'),
    // Where the episode came from (e.g. a YouTube URL), if it was imported.
    sourceUrl: text('sourceUrl'),
    // The processed audio file, once ready.
    audioUrl: text('audioUrl'),
    audioMimeType: text('audioMimeType'),
    audioSizeBytes: bigint('audioSizeBytes', { mode: 'number' }),
    durationSeconds: integer('durationSeconds'),
    status: episodeStatus('status').notNull().default('pending'),
    // Why processing failed, when status is 'failed'.
    error: text('error'),
    explicit: boolean('explicit').notNull().default(false),
    publishedAt: timestamp('publishedAt', { mode: 'date', withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('episode_podcastId_publishedAt_idx').on(table.podcastId, table.publishedAt)],
)

export const usersRelations = relations(users, ({ many }) => ({
  podcasts: many(podcasts),
}))

export const podcastsRelations = relations(podcasts, ({ one, many }) => ({
  owner: one(users, { fields: [podcasts.userId], references: [users.id] }),
  episodes: many(episodes),
}))

export const episodesRelations = relations(episodes, ({ one }) => ({
  podcast: one(podcasts, { fields: [episodes.podcastId], references: [podcasts.id] }),
}))

export type Podcast = typeof podcasts.$inferSelect
export type NewPodcast = typeof podcasts.$inferInsert
export type Episode = typeof episodes.$inferSelect
export type NewEpisode = typeof episodes.$inferInsert
export type EpisodeStatus = (typeof episodeStatus.enumValues)[number]
