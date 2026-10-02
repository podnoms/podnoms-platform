// Database schema. The users, accounts, sessions and verificationTokens tables
// follow the shape @auth/drizzle-adapter expects; `passwordHash` is an extra
// column for email/password sign-in.
import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
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
    // The authenticator app secret, encrypted (see two-factor.server.ts), once
    // the user has set one up.
    totpSecret: text('totpSecret'),
    // The time step of the last accepted authenticator code, so a code can't
    // be used twice.
    totpLastStep: integer('totpLastStep'),
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
  'verification_token',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
)

// --- Two-factor authentication ----------------------------------------------

// A security key (such as a YubiKey) registered as a second factor via WebAuthn.
export const securityKeys = pgTable(
  'security_key',
  {
    // The WebAuthn credential ID, base64url-encoded.
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // The COSE public key, base64url-encoded.
    publicKey: text('publicKey').notNull(),
    // The key's signature counter, which only goes up unless the key was cloned.
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports').array(),
    createdAt: timestamp('createdAt', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('lastUsedAt', { mode: 'date', withTimezone: true }),
  },
  (table) => [index('security_key_userId_idx').on(table.userId)],
)

// Single-use codes for signing in without the second factor, stored hashed.
export const recoveryCodes = pgTable(
  'recovery_code',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('codeHash').notNull(),
    usedAt: timestamp('usedAt', { mode: 'date', withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.codeHash] })],
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
    // Used in the episode's URL, so unique within the podcast. Kept when the
    // title is edited, so links keep working.
    slug: text('slug').notNull(),
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
    // Why processing failed, when status is 'failed'; on a ready episode, why
    // replacing its audio failed.
    error: text('error'),
    // New audio for a ready episode, while it's being made: from a link, or
    // from an uploaded file (in sources/) when sourceUrl is null. The current
    // audio stays live until the new audio is ready.
    replacement: jsonb('replacement').$type<EpisodeReplacement>(),
    explicit: boolean('explicit').notNull().default(false),
    publishedAt: timestamp('publishedAt', { mode: 'date', withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('episode_podcastId_publishedAt_idx').on(table.podcastId, table.publishedAt),
    uniqueIndex('episode_podcastId_slug_idx').on(table.podcastId, table.slug),
  ],
)

// Where a user left off in an episode, so playback resumes there on any device.
export const playbackPositions = pgTable(
  'playback_position',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: text('episodeId')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    positionSeconds: integer('positionSeconds').notNull(),
    updatedAt: timestamps.updatedAt,
  },
  (table) => [primaryKey({ columns: [table.userId, table.episodeId] })],
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
export type EpisodeReplacement = { sourceUrl: string | null }
export type EpisodeStatus = (typeof episodeStatus.enumValues)[number]
