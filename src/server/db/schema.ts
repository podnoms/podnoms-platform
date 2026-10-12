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
  pgSchema,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from '@auth/core/adapters'
import type { DirectoryLinks } from '../../lib/podcast-directories'
import { randomShortSlug } from '../../lib/slug'

// Signing in: OAuth accounts, second factors, recovery codes and password
// reset links, apart from the app's own tables. The user table stays in
// public, as nearly everything refers to it.
export const authSchema = pgSchema('auth')

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
    // About the user, as sanitised HTML (see rich-text.server.ts).
    description: text('description'),
    // Set only for users who registered with an email and password.
    passwordHash: text('passwordHash'),
    // The authenticator app secret, encrypted (see two-factor.server.ts), once
    // the user has set one up.
    totpSecret: text('totpSecret'),
    // The time step of the last accepted authenticator code, so a code can't
    // be used twice.
    totpLastStep: integer('totpLastStep'),
    // Admins can manage the whole site (e.g. the job queues). The first user
    // to sign up becomes one (see firstUserIsAdmin in users.server.ts).
    isAdmin: boolean('isAdmin').notNull().default(false),
    // Which emails the user gets about their podcasts (see notifications.server.ts).
    notifyEpisodeFailed: boolean('notifyEpisodeFailed').notNull().default(true),
    notifyNewEpisodes: boolean('notifyNewEpisodes').notNull().default(true),
    // How many of a channel's newest uploads are imported when the user makes
    // a podcast from it, and considered on each check. Set by admins.
    channelEpisodeLimit: integer('channelEpisodeLimit').notNull().default(10),
  },
  // Emails are unique regardless of case, across OAuth and password users.
  (table) => [uniqueIndex('user_email_lower_idx').on(sql`lower(${table.email})`)],
)

export const accounts = authSchema.table(
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
export const sessions = authSchema.table('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = authSchema.table(
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
export const securityKeys = authSchema.table(
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
export const recoveryCodes = authSchema.table(
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
    // One of Apple's categories and, optionally, one of its subcategories (see
    // src/lib/podcast-directories.ts).
    category: text('category'),
    subcategory: text('subcategory'),
    language: text('language').notNull().default('en'),
    explicit: boolean('explicit').notNull().default(false),
    // Private podcasts' pages are only shown to their owner, and their feed
    // and audio are only served with feedKey (see feed.server.ts), which the
    // owner gives to the listeners they choose. The key is made when the
    // podcast is first made private, and can be reset to cut listeners off.
    private: boolean('private').notNull().default(false),
    feedKey: text('feedKey'),
    // Who makes it, as shown in podcast apps; the owner's name when not set.
    author: text('author'),
    // Where directories (Spotify, say) send the code that confirms the show is
    // the owner's. Public: it's in the feed. Only set if the owner chooses to.
    ownerEmail: text('ownerEmail'),
    // The podcast's pages on Apple Podcasts, Spotify and the rest, once listed.
    directoryLinks: jsonb('directoryLinks').$type<DirectoryLinks>().notNull().default({}),
    // The owner's own domain for the podcast (see custom-domains.server.ts). It's
    // only served once its DNS records check out: a CNAME to us, and a TXT record
    // holding customDomainToken, which proves the owner controls the domain.
    customDomain: text('customDomain').unique(),
    customDomainToken: text('customDomainToken'),
    customDomainVerifiedAt: timestamp('customDomainVerifiedAt', { mode: 'date', withTimezone: true }),
    // When a verified domain's records first stopped checking out; it's dropped
    // after a few days of that, in case it was a passing DNS problem.
    customDomainFailingSince: timestamp('customDomainFailingSince', { mode: 'date', withTimezone: true }),
    // The key OBS sends to broadcast live (see live.server.ts), encrypted
    // (secrets.server.ts) so the owner can see it again; null until they make one.
    liveKey: text('liveKey'),
    // The title of the next broadcast, and of the episode made from it.
    liveTitle: text('liveTitle'),
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
    // For the episode's share page (/s/<shortSlug>). Unique across the site,
    // and never changes.
    shortSlug: text('shortSlug')
      .notNull()
      .$defaultFn(() => randomShortSlug()),
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
    // Private episodes are only shown to their podcast's owner: they're left
    // out of the feed and public pages, and their audio isn't served to anyone else.
    private: boolean('private').notNull().default(false),
    publishedAt: timestamp('publishedAt', { mode: 'date', withTimezone: true }),
    // Downloads with a higher priority go first (see download-throttle.server.ts):
    // 1 for links added by hand, 0 for a channel's uploads.
    priority: smallint('priority').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index('episode_podcastId_publishedAt_idx').on(table.podcastId, table.publishedAt),
    uniqueIndex('episode_podcastId_slug_idx').on(table.podcastId, table.slug),
    uniqueIndex('episode_shortSlug_idx').on(table.shortSlug),
  ],
)

// --- Channels ---------------------------------------------------------------

// A YouTube channel, Mixcloud user or the like that a podcast follows: its
// newest uploads become episodes, and it's checked for new ones (see
// channels.server.ts).
export const channels = pgTable(
  'channel',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    podcastId: text('podcastId')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    // Which of channelProviders (src/lib/platforms.ts) it's on.
    platform: text('platform').notNull(),
    // Normalised to the list of uploads, as yt-dlp is given it.
    url: text('url').notNull(),
    title: text('title'),
    // Paused channels aren't checked.
    enabled: boolean('enabled').notNull().default(true),
    lastCheckedAt: timestamp('lastCheckedAt', { mode: 'date', withTimezone: true }),
    nextCheckAt: timestamp('nextCheckAt', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    // Why the last check failed, if it did.
    lastError: text('lastError'),
    ...timestamps,
  },
  (table) => [index('channel_podcastId_idx').on(table.podcastId), index('channel_nextCheckAt_idx').on(table.nextCheckAt)],
)

// Every upload a channel has listed, whether or not it became an episode, so
// that nothing is downloaded twice, or again after its episode is deleted.
export const channelItems = pgTable(
  'channel_item',
  {
    channelId: text('channelId')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    // "<platform>:<the platform's id for the upload>"
    sourceKey: text('sourceKey').notNull(),
    episodeId: text('episodeId').references(() => episodes.id, { onDelete: 'set null' }),
    seenAt: timestamp('seenAt', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.channelId, table.sourceKey] }), index('channel_item_episodeId_idx').on(table.episodeId)],
)

// Links emailed to reset a password: only a hash of each token is kept, and
// they're deleted once used (see password-reset.server.ts).
export const passwordResetTokens = authSchema.table(
  'password_reset_token',
  {
    tokenHash: text('tokenHash').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expiresAt', { mode: 'date', withTimezone: true }).notNull(),
    createdAt: timestamp('createdAt', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('password_reset_token_userId_idx').on(table.userId)],
)

// --- Site settings ----------------------------------------------------------

// Settings for the whole site, edited by admins: one row for each setting
// that has been saved, with its value as JSON. Settings without a row have
// their default; the names, types and defaults are in site-settings.server.ts.
// Keys starting "__" are the app's own (such as the day's visitor salt, see
// activity.server.ts), never shown as settings.
export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamps.updatedAt,
})

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

// Episodes a user likes: listed on their Likes page, and counted on the
// episode for everyone to see (see library.server.ts).
export const episodeLikes = pgTable(
  'episode_like',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: text('episodeId')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.episodeId] }),
    index('episode_like_episodeId_idx').on(table.episodeId),
  ],
)

// Podcasts a user follows: their new episodes come to the user's home page,
// and the podcast shows how many follow it.
export const podcastFollows = pgTable(
  'podcast_follow',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    podcastId: text('podcastId')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.podcastId] }),
    index('podcast_follow_podcastId_idx').on(table.podcastId),
  ],
)

// Comments on an episode, each at a point in it, listed in that order on the
// episode's page and marked on its waveform (see comments.server.ts).
export const episodeComments = pgTable(
  'episode_comment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    episodeId: text('episodeId')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Plain text, not HTML.
    body: text('body').notNull(),
    // How far into the episode it was made.
    atSeconds: integer('atSeconds').notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index('episode_comment_episodeId_atSeconds_idx').on(table.episodeId, table.atSeconds)],
)

// --- Live -------------------------------------------------------------------

// A live broadcast of a podcast, streamed from OBS through MediaMTX (see
// live.server.ts). Open while endedAt is null; once it ends, its recording
// becomes a private episode (see live-recordings.server.ts).
export const liveBroadcasts = pgTable(
  'live_broadcast',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    podcastId: text('podcastId')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    startedAt: timestamp('startedAt', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    // When MediaMTX last listed the stream, so a dropped connection that comes
    // back soon continues the same broadcast.
    lastSeenAt: timestamp('lastSeenAt', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
    // When MediaMTX stopped listing the stream, while it's gone: OBS may be
    // reconnecting, or the show may be over, which its owner is asked.
    interruptedAt: timestamp('interruptedAt', { mode: 'date', withTimezone: true }),
    endedAt: timestamp('endedAt', { mode: 'date', withTimezone: true }),
    // The episode made from its recording.
    episodeId: text('episodeId').references(() => episodes.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('live_broadcast_podcastId_startedAt_idx').on(table.podcastId, table.startedAt),
    // A podcast has at most one broadcast open.
    uniqueIndex('live_broadcast_open_idx').on(table.podcastId).where(sql`${table.endedAt} is null`),
  ],
)

// What viewers write in a broadcast's chat. Plain text, not HTML.
export const liveChatMessages = pgTable(
  'live_chat_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    broadcastId: text('broadcastId')
      .notNull()
      .references(() => liveBroadcasts.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index('live_chat_message_broadcastId_createdAt_idx').on(table.broadcastId, table.createdAt)],
)

// What listeners do with episodes, for podcast owners' stats (see
// activity.server.ts). Nothing here identifies a person: there's no IP or
// account, only a hash that changes daily and where they roughly were.
export const activityType = pgEnum('activity_type', ['play', 'download', 'share'])
// Where it happened: the site's own pages, an episode's share page, a
// player embedded on another site, or a podcast app (or anything else)
// fetching the audio directly.
export const activitySource = pgEnum('activity_source', ['web', 'listen', 'embed', 'app'])

export const episodeActivity = pgTable(
  'episode_activity',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    episodeId: text('episodeId')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    podcastId: text('podcastId')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    type: activityType('type').notNull(),
    source: activitySource('source').notNull(),
    // For a share, what was shared: 'link' or 'embed'.
    detail: text('detail'),
    // The IP address and user agent, hashed with that day's salt (see
    // saltFor in activity.server.ts), so a visitor can be counted once a day
    // but not followed from one day to the next.
    visitorHash: text('visitorHash').notNull(),
    // From the IP address, which isn't kept. ISO 3166 codes for the country
    // and region.
    country: text('country'),
    region: text('region'),
    city: text('city'),
    // From the user agent: the app or browser, its OS and the kind of device.
    client: text('client'),
    os: text('os'),
    device: text('device'),
    userAgent: text('userAgent'),
    // The site that linked or embedded it, if any.
    referrerHost: text('referrerHost'),
    occurredAt: timestamp('occurredAt', { mode: 'date', withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('episode_activity_podcastId_occurredAt_idx').on(table.podcastId, table.occurredAt),
    index('episode_activity_episodeId_occurredAt_idx').on(table.episodeId, table.occurredAt),
    // Each visitor counts once a day for each episode and kind of activity;
    // hashes change daily, so this is per day.
    uniqueIndex('episode_activity_once_a_day_idx').on(table.episodeId, table.type, table.visitorHash),
  ],
)

export const usersRelations = relations(users, ({ many }) => ({
  podcasts: many(podcasts),
}))

export const podcastsRelations = relations(podcasts, ({ one, many }) => ({
  owner: one(users, { fields: [podcasts.userId], references: [users.id] }),
  episodes: many(episodes),
  channels: many(channels),
}))

export const channelsRelations = relations(channels, ({ one, many }) => ({
  podcast: one(podcasts, { fields: [channels.podcastId], references: [podcasts.id] }),
  items: many(channelItems),
}))

export const channelItemsRelations = relations(channelItems, ({ one }) => ({
  channel: one(channels, { fields: [channelItems.channelId], references: [channels.id] }),
}))

export const episodesRelations = relations(episodes, ({ one }) => ({
  podcast: one(podcasts, { fields: [episodes.podcastId], references: [podcasts.id] }),
}))

export type Podcast = typeof podcasts.$inferSelect
export type NewPodcast = typeof podcasts.$inferInsert
export type Episode = typeof episodes.$inferSelect
export type NewEpisode = typeof episodes.$inferInsert
export type Channel = typeof channels.$inferSelect
export type LiveBroadcast = typeof liveBroadcasts.$inferSelect
export type EpisodeReplacement = { sourceUrl: string | null }
export type EpisodeStatus = (typeof episodeStatus.enumValues)[number]
export type ActivityType = (typeof activityType.enumValues)[number]
export type ActivitySource = (typeof activitySource.enumValues)[number]
