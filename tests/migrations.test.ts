// The migrations in drizzle/, including the hand-written data migrations,
// applied to data in the shape it had before them.
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { plainTextToHtml } from '~/lib/rich-text'
import { slugify } from '~/lib/slug'
import { migrationStatements } from './db'

async function migrateUntil(pg: PGlite, stopBefore?: string) {
  for (const { tag, statements } of migrationStatements()) {
    if (tag === stopBefore) return
    for (const statement of statements) await pg.exec(statement)
  }
}

async function runMigration(pg: PGlite, tag: string) {
  const migration = migrationStatements().find((m) => m.tag === tag)!
  for (const statement of migration.statements) await pg.exec(statement)
}

const tagOf = (prefix: string) => migrationStatements().find((m) => m.tag.startsWith(prefix))!.tag

describe('migrations', () => {
  it("0039 renames episodes whose slugs clash with paths under their show, and moves the inbox's links", async () => {
    const pg = new PGlite()
    try {
      await migrateUntil(pg, tagOf('0039'))
      await pg.exec(`insert into "user" (id, email, slug) values ('u1', 'u@example.com', 'u');
        insert into show (id, "userId", title, slug) values ('p1', 'u1', 'Mixes', 'mixes');
        insert into episode (id, "showId", title, slug, "shortSlug") values
          ('e1', 'p1', 'Manage', 'manage', 'aaaaaaaa'),
          ('e2', 'p1', 'Episodes', 'episodes', 'bbbbbbbb'),
          ('e3', 'p1', 'November', 'november', 'cccccccc');
        insert into notification (id, "userId", kind, title, url) values
          ('n1', 'u1', 'mention', 'Hi', '/mixes/episodes/november#comment-1'),
          ('n2', 'u1', 'episodeFailed', 'Oops', '/mixes/episodes/november/manage'),
          ('n3', 'u1', 'live', 'Live', '/live/mixes');`)
      await runMigration(pg, tagOf('0039'))

      const { rows: episodes } = await pg.query<{ id: string; slug: string }>(`select id, slug from episode order by id`)
      expect(episodes[0]!.slug).toMatch(/^manage-[0-9a-f]{6}$/)
      expect(episodes[1]!.slug).toMatch(/^episodes-[0-9a-f]{6}$/)
      expect(episodes[2]!.slug).toBe('november')
      expect((await pg.query(`select id, url from notification order by id`)).rows).toEqual([
        { id: 'n1', url: '/mixes/november#comment-1' },
        { id: 'n2', url: '/mixes/november/manage' },
        { id: 'n3', url: '/live/mixes' },
      ])
    } finally {
      await pg.close()
    }
  })

  it('0038 renames podcasts to shows, keeping their episodes, tags, follows and reports', async () => {
    const pg = new PGlite()
    try {
      await migrateUntil(pg, tagOf('0038'))
      await pg.exec(`insert into "user" (id, email, slug) values ('u1', 'u@example.com', 'u');
        insert into podcast (id, "userId", title, slug) values ('p1', 'u1', 'Mixes', 'mixes');
        insert into episode (id, "podcastId", title, slug, "shortSlug") values ('e1', 'p1', 'One', 'one', 'abcdefgh');
        insert into tag (id, name, slug) values ('t1', 'House', 'house');
        insert into podcast_tag ("podcastId", "tagId") values ('p1', 't1');
        insert into podcast_follow ("userId", "podcastId") values ('u1', 'p1');
        insert into content_report (id, "targetKind", "targetId", "imageUrl", reason, "reporterHash") values
          ('r1', 'podcast', 'p1', '/images/a.webp', 'sexual', 'h1'),
          ('r2', 'episode', 'e1', '/images/b.webp', 'sexual', 'h1');`)
      await runMigration(pg, tagOf('0038'))

      expect((await pg.query(`select id, slug from show`)).rows).toEqual([{ id: 'p1', slug: 'mixes' }])
      expect((await pg.query(`select id, "showId" from episode`)).rows).toEqual([{ id: 'e1', showId: 'p1' }])
      expect((await pg.query(`select "showId", "tagId" from show_tag`)).rows).toEqual([{ showId: 'p1', tagId: 't1' }])
      expect((await pg.query(`select "userId", "showId" from show_follow`)).rows).toEqual([{ userId: 'u1', showId: 'p1' }])
      expect((await pg.query(`select id, "targetKind" from content_report order by id`)).rows).toEqual([
        { id: 'r1', targetKind: 'show' },
        { id: 'r2', targetKind: 'episode' },
      ])
      // Slug conflicts are recognised by these names (isSlugConflict).
      await expect(pg.exec(`insert into show (id, "userId", title, slug) values ('p2', 'u1', 'Again', 'mixes')`)).rejects.toMatchObject({
        message: expect.stringContaining('show_slug_unique'),
      })
      // Deleting a show still takes its episodes with it.
      await pg.exec(`delete from show where id = 'p1'`)
      expect((await pg.query(`select id from episode`)).rows).toEqual([])
    } finally {
      await pg.close()
    }
  })

  it('0033 gives every user a slug from their name or email, each unique', async () => {
    const pg = new PGlite()
    try {
      await migrateUntil(pg, tagOf('0033'))
      await pg.exec(`insert into "user" (id, name, email) values
        ('a', 'Fergal Moran', 'f@example.com'),
        ('b', 'Fergal  Moran!', 'other@example.com'),
        ('c', null, 'Jo.Bloggs@example.com'),
        ('d', '✨', 'x@example.com'),
        ('e', null, null),
        ('f', 'A very long name that goes on and on past thirty', null);`)
      await runMigration(pg, tagOf('0033'))
      const { rows } = await pg.query<{ id: string; slug: string }>('select id, slug from "user" order by id')
      expect(Object.fromEntries(rows.map((row) => [row.id, row.slug]))).toEqual({
        a: 'fergal-moran',
        b: 'fergal-moran-2',
        c: 'jo-bloggs',
        d: 'user',
        e: 'user-2',
        f: 'a-very-long-name-that-goes-on',
      })
    } finally {
      await pg.close()
    }
  })

  it("0030 re-keys yt-dlp's Mixcloud uploads by their page and deletes the episodes imported twice", async () => {
    const pg = new PGlite()
    try {
      await migrateUntil(pg, tagOf('0030'))
      await pg.exec(`insert into "user" (id, email) values ('u1', 'mixes@example.com');
        insert into podcast (id, "userId", title, slug) values ('p1', 'u1', 'Mixes', 'mixes'), ('p2', 'u1', 'More mixes', 'more-mixes');
        insert into channel (id, "podcastId", platform, url) values
          ('mc', 'p1', 'mixcloud', 'https://www.mixcloud.com/someone/uploads/'),
          ('yt', 'p1', 'youtube', 'https://www.youtube.com/@someone/videos'),
          ('mc2', 'p2', 'mixcloud', 'https://www.mixcloud.com/someone/uploads/');
        insert into episode (id, "podcastId", title, slug, "shortSlug", "sourceUrl") values
          ('a', 'p1', 'A', 'a', 'sa', 'https://www.mixcloud.com/someone/a/'),
          ('a2', 'p1', 'A', 'a-2', 'sa2', 'https://www.mixcloud.com/someone/a/'),
          ('b', 'p1', 'B', 'b', 'sb', 'https://www.mixcloud.com/someone/b'),
          ('c', 'p1', 'C', 'c', 'sc', 'https://www.mixcloud.com/someone/c/'),
          ('v', 'p1', 'V', 'v', 'sv', 'https://www.youtube.com/watch?v=v'),
          ('m', 'p1', 'A by hand', 'a-by-hand', 'sm', 'https://www.mixcloud.com/someone/a/'),
          ('pa', 'p2', 'A', 'a', 'spa', 'https://www.mixcloud.com/someone/a/');
        insert into channel_item ("channelId", "sourceKey", "episodeId") values
          ('mc', 'mixcloud:someone_a', 'a'),
          ('mc', 'mixcloud:/someone/a/', 'a2'),
          ('mc', 'mixcloud:someone_b', 'b'),
          ('mc', 'mixcloud:/someone/c/', 'c'),
          ('mc', 'mixcloud:someone_gone', null),
          ('yt', 'youtube:v', 'v'),
          ('mc2', 'mixcloud:/someone/a/', 'pa');`)
      await runMigration(pg, tagOf('0030'))
      const items = await pg.query<{ channelId: string; sourceKey: string; episodeId: string | null }>(
        'select "channelId", "sourceKey", "episodeId" from channel_item order by "channelId", "sourceKey"',
      )
      expect(items.rows).toEqual([
        { channelId: 'mc', sourceKey: 'mixcloud:/someone/a/', episodeId: 'a' },
        { channelId: 'mc', sourceKey: 'mixcloud:/someone/b/', episodeId: 'b' },
        { channelId: 'mc', sourceKey: 'mixcloud:/someone/c/', episodeId: 'c' },
        { channelId: 'mc', sourceKey: 'mixcloud:someone_gone', episodeId: null },
        { channelId: 'mc2', sourceKey: 'mixcloud:/someone/a/', episodeId: 'pa' },
        { channelId: 'yt', sourceKey: 'youtube:v', episodeId: 'v' },
      ])
      const left = await pg.query<{ id: string }>('select id from episode order by id')
      // Another show's copy of the same upload, and one added by hand, stay.
      expect(left.rows.map((row) => row.id)).toEqual(['a', 'b', 'c', 'm', 'pa', 'v'])
    } finally {
      await pg.close()
    }
  })

  it('0029 gives existing tags unique readable slugs while preserving associations', async () => {
    const pg = new PGlite()
    try {
      await migrateUntil(pg, tagOf('0029'))
      const names = ['deep house', 'deep-house', 'deep-house-2', 'café', 'cafe', '🎵', '🎶', 'house']
      for (const [i, name] of names.entries()) {
        await pg.query('insert into tag (id, name) values ($1, $2)', [`t${i}`, name])
      }
      await pg.exec(`insert into "user" (id, email) values ('u1', 'tags@example.com');
        insert into podcast (id, "userId", title, slug) values ('p1', 'u1', 'Show', 'show');
        insert into podcast_tag ("podcastId", "tagId") values ('p1', 't0');`)
      await runMigration(pg, tagOf('0029'))
      const { rows } = await pg.query<{ id: string; name: string; slug: string }>('select * from tag')
      expect(rows).toHaveLength(names.length)
      expect(new Set(rows.map((tag) => tag.slug)).size).toBe(names.length)
      expect(rows.find((tag) => tag.name === 'deep house')!.slug).toBe('deep-house')
      expect(rows.find((tag) => tag.name === 'house')!.slug).toBe('house')
      for (const tag of rows) {
        const base = slugify(tag.name, 'tag')
        expect(tag.slug === base || new RegExp(`^${base}-[0-9]+$`).test(tag.slug)).toBe(true)
      }
      expect((await pg.query('select * from podcast_tag')).rows).toEqual([{ podcastId: 'p1', tagId: 't0' }])
      await expect(pg.query("insert into tag (id, name, slug) values ('dup', 'different', 'house')")).rejects.toThrow()
    } finally {
      await pg.close()
    }
  })

  it('apply cleanly to an empty database', async () => {
    const pg = new PGlite()
    await migrateUntil(pg)
    const { rows } = await pg.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`)
    expect(rows.map((r) => r.tablename)).toEqual([
      'channel',
      'channel_item',
      'comment_like',
      'comment_mention',
      'content_report',
      'episode',
      'episode_activity',
      'episode_comment',
      'episode_like',
      'episode_tag',
      'live_broadcast',
      'live_chat_message',
      'notification',
      'playback_position',
      'playlist',
      'playlist_item',
      'push_subscription',
      'show',
      'show_follow',
      'show_tag',
      'site_settings',
      'tag',
      'tracked_link',
      'user',
    ])
    const { rows: auth } = await pg.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'auth' order by 1`)
    expect(auth.map((r) => r.tablename)).toEqual([
      'account',
      'mobile_token',
      'password_reset_token',
      'recovery_code',
      'security_key',
      'session',
      'verification_token',
    ])
  })

  it('0023 moves the sign-in tables to the auth schema, keeping their rows and links to users', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0023'))
    await pg.query(`insert into "user" (id, email) values ('u1', 'u@example.com')`)
    await pg.query(`insert into account ("userId", type, provider, "providerAccountId") values ('u1', 'oauth', 'github', '42')`)
    await pg.query(`insert into recovery_code ("userId", "codeHash") values ('u1', 'hash')`)
    await runMigration(pg, tagOf('0023'))

    const { rows: accounts } = await pg.query(`select provider from auth.account`)
    expect(accounts).toEqual([{ provider: 'github' }])
    // Deleting the user still takes their sign-in rows with them.
    await pg.query(`delete from "user" where id = 'u1'`)
    const { rows: codes } = await pg.query(`select * from auth.recovery_code`)
    expect(codes).toEqual([])
  })

  it('0022 renames the settings table and moves the latest visitor salt into it', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0022'))
    await pg.query(`insert into visitor_salt (day, salt) values ('2026-10-11', 'old'), ('2026-10-12', 'today')`)
    await runMigration(pg, tagOf('0022'))

    const { rows } = await pg.query(`select value from site_settings where key = '__visitorSalt'`)
    expect(rows).toEqual([{ value: { day: '2026-10-12', salt: 'today' } }])
    const { rows: tables } = await pg.query(`select tablename from pg_tables where tablename in ('site_setting', 'visitor_salt')`)
    expect(tables).toEqual([])
    const { rows: keys } = await pg.query(`select conname from pg_constraint where conrelid = 'site_settings'::regclass and contype = 'p'`)
    expect(keys).toEqual([{ conname: 'site_settings_pkey' }])
  })

  it('0022 makes no salt when there was none', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0022'))
    await runMigration(pg, tagOf('0022'))
    const { rows } = await pg.query(`select key from site_settings where key = '__visitorSalt'`)
    expect(rows).toEqual([])
  })

  it('0021 moves the site settings into a row each, keeping the values saved', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0021'))
    await pg.query(`update site_setting set "downloadConcurrency" = 5, "downloadRateLimit" = '2M', "smtpSecure" = true`)
    await runMigration(pg, tagOf('0021'))

    const { rows } = await pg.query<{ key: string; value: unknown }>(`select key, value from site_setting order by key`)
    expect(Object.fromEntries(rows.map((row) => [row.key, row.value]))).toEqual({
      channelCheckHours: 6,
      downloadConcurrency: 5,
      downloadDelaySeconds: 10,
      downloadRateLimit: '2M',
      perPlatformConcurrency: 2,
      smtpPort: 587,
      smtpSecure: true,
    })
    const { rows: tables } = await pg.query(`select tablename from pg_tables where tablename = 'site_setting_old'`)
    expect(tables).toEqual([])
    const { rows: keys } = await pg.query(`select conname from pg_constraint where conrelid = 'site_setting'::regclass and contype = 'p'`)
    expect(keys).toEqual([{ conname: 'site_setting_pkey' }])
  })

  it('0016 gives each private podcast its own feed key, and public ones none', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0016'))
    await pg.query(`insert into "user" (id, email) values ('u1', 'u@example.com')`)
    await pg.query(
      `insert into podcast (id, "userId", title, slug, private) values ('p1', 'u1', 'A', 'a', true), ('p2', 'u1', 'B', 'b', true), ('p3', 'u1', 'C', 'c', false)`,
    )

    await runMigration(pg, tagOf('0016'))

    const { rows } = await pg.query<{ id: string; feedKey: string | null }>(`select id, "feedKey" from podcast order by id`)
    expect(rows[0]!.feedKey).toMatch(/^[0-9a-f]{32}$/)
    expect(rows[1]!.feedKey).toMatch(/^[0-9a-f]{32}$/)
    expect(rows[0]!.feedKey).not.toBe(rows[1]!.feedKey)
    expect(rows[2]!.feedKey).toBeNull()
  })

  it('0014 turns both notifications on for existing users', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0014'))
    await pg.query(`insert into "user" (id, email) values ('u1', 'u@example.com')`)
    await runMigration(pg, tagOf('0014'))
    const { rows } = await pg.query(`select "notifyEpisodeFailed", "notifyNewEpisodes" from "user"`)
    expect(rows).toEqual([{ notifyEpisodeFailed: true, notifyNewEpisodes: true }])
  })

  it("0013 clears categories that aren't Apple's, keeping the rest", async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0013'))
    await pg.query(`insert into "user" (id, email) values ('u1', 'u@example.com')`)
    await pg.query(
      `insert into podcast (id, "userId", title, slug, category) values
        ('p1', 'u1', 'P', 'p1', 'Music'), ('p2', 'u1', 'P', 'p2', 'TV & Film'), ('p3', 'u1', 'P', 'p3', 'Podcasts'), ('p4', 'u1', 'P', 'p4', null)`,
    )
    await runMigration(pg, tagOf('0013'))

    const { rows } = await pg.query(`select id, category, "directoryLinks" from podcast order by id`)
    expect(rows).toEqual([
      { id: 'p1', category: 'Music', directoryLinks: {} },
      { id: 'p2', category: 'TV & Film', directoryLinks: {} },
      { id: 'p3', category: null, directoryLinks: {} },
      { id: 'p4', category: null, directoryLinks: {} },
    ])
  })

  it('0011 makes the site settings, with the defaults, and gives existing users the default channel limit', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0011'))
    await pg.query(`insert into "user" (id, email) values ('u1', 'u@example.com')`)
    await runMigration(pg, tagOf('0011'))

    const { rows: settings } = await pg.query(`select * from site_setting`)
    expect(settings).toEqual([
      expect.objectContaining({
        id: 'global',
        downloadConcurrency: 3,
        perPlatformConcurrency: 2,
        downloadDelaySeconds: 10,
        channelCheckHours: 6,
        downloadRateLimit: null,
      }),
    ])
    const { rows: users } = await pg.query<{ channelEpisodeLimit: number }>(`select "channelEpisodeLimit" from "user"`)
    expect(users).toEqual([{ channelEpisodeLimit: 10 }])
  })

  it('0004 converts plain-text descriptions to HTML as plainTextToHtml does', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0004'))
    const texts = ['One\n\nTwo\nthree', '  a < b & c > d  ', 'Windows\r\n\r\nlines', 'x\n\n\n\ny']
    await pg.query(`insert into "user" (id, email) values ('u1', 'u@example.com')`)
    await pg.query(`insert into podcast (id, "userId", title, slug, description) values ('p1', 'u1', 'P', 'p', $1)`, [texts[0]])
    for (const [i, text] of texts.entries()) {
      await pg.query(`insert into episode (id, "podcastId", title, description) values ($1, 'p1', 'E', $2)`, [`e${i}`, text])
    }
    await pg.query(`insert into episode (id, "podcastId", title, description) values ('html', 'p1', 'E', '<p>Already</p>')`)
    await pg.query(`insert into episode (id, "podcastId", title, description) values ('empty', 'p1', 'E', '')`)
    await pg.query(`insert into episode (id, "podcastId", title, description) values ('null', 'p1', 'E', null)`)

    await runMigration(pg, tagOf('0004'))

    const description = async (table: string, id: string) =>
      (await pg.query<{ description: string | null }>(`select description from ${table} where id = $1`, [id])).rows[0]!.description
    expect(await description('podcast', 'p1')).toBe(plainTextToHtml(texts[0]!))
    for (const [i, text] of texts.entries()) expect(await description('episode', `e${i}`)).toBe(plainTextToHtml(text))
    expect(await description('episode', 'html')).toBe('<p>Already</p>')
    expect(await description('episode', 'empty')).toBe('')
    expect(await description('episode', 'null')).toBeNull()
  })

  it('0005 gives existing episodes slugs, numbered by age within each podcast', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0005'))
    await pg.query(`insert into "user" (id, email) values ('u1', 'u@example.com')`)
    await pg.query(`insert into podcast (id, "userId", title, slug) values ('p1', 'u1', 'P1', 'p1'), ('p2', 'u1', 'P2', 'p2')`)
    const episodes = [
      ['a', 'p1', 'Same Title', '2026-01-01'],
      ['b', 'p1', 'Same Title', '2026-01-02'],
      ['c', 'p1', 'same title!', '2026-01-03'],
      ['d', 'p2', 'Same Title', '2026-01-04'],
      ['e', 'p1', '???', '2026-01-05'],
      ['f', 'p1', 'x'.repeat(70), '2026-01-06'],
    ]
    for (const [id, podcastId, title, createdAt] of episodes) {
      await pg.query(`insert into episode (id, "podcastId", title, "createdAt") values ($1, $2, $3, $4)`, [id, podcastId, title, createdAt])
    }

    await runMigration(pg, tagOf('0005'))

    const { rows } = await pg.query<{ id: string; slug: string }>(`select id, slug from episode order by id`)
    expect(Object.fromEntries(rows.map((r) => [r.id, r.slug]))).toEqual({
      a: 'same-title',
      b: 'same-title-2',
      c: 'same-title-3',
      d: 'same-title',
      e: 'episode',
      f: slugify('x'.repeat(70), 'episode'),
    })
    // The unique index is in place afterwards.
    await expect(
      pg.query(`insert into episode (id, "podcastId", title, slug) values ('z', 'p1', 'Z', 'same-title')`),
    ).rejects.toThrow(/episode_podcastId_slug_idx/)
  })

  it('0006 adds two-factor auth to an existing database, keeping its data', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0006'))
    await pg.query(`insert into "user" (id, email, "passwordHash") values ('u1', 'u@example.com', 'hash')`)
    await pg.query(`insert into "verificationToken" (identifier, token, expires) values ('u@example.com', 't1', now())`)

    await runMigration(pg, tagOf('0006'))

    const { rows: users } = await pg.query(`select id, "passwordHash", "totpSecret", "totpLastStep" from "user"`)
    expect(users).toEqual([{ id: 'u1', passwordHash: 'hash', totpSecret: null, totpLastStep: null }])
    const { rows: tokens } = await pg.query<{ token: string }>(`select token from verification_token`)
    expect(tokens.map((r) => r.token)).toEqual(['t1'])
    await pg.query(`insert into recovery_code ("userId", "codeHash") values ('u1', 'c1')`)
    await pg.query(`insert into security_key (id, "userId", name, "publicKey") values ('k1', 'u1', 'Key', 'pk')`)
    // The renamed primary key still holds.
    await expect(
      pg.query(`insert into verification_token (identifier, token, expires) values ('u@example.com', 't1', now())`),
    ).rejects.toThrow(/verification_token_identifier_token_pk/)
  })

  it('0009 makes the only user of an existing site an admin', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0009'))
    await pg.query(`insert into "user" (id, email) values ('u1', 'u@example.com')`)

    await runMigration(pg, tagOf('0009'))

    const { rows } = await pg.query(`select id, "isAdmin" from "user"`)
    expect(rows).toEqual([{ id: 'u1', isAdmin: true }])
  })

  it("0009 makes nobody an admin when there's no telling who signed up first", async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0009'))
    await pg.query(`insert into "user" (id, email) values ('u1', 'a@example.com'), ('u2', 'b@example.com')`)

    await runMigration(pg, tagOf('0009'))

    const { rows } = await pg.query(`select id, "isAdmin" from "user" order by id`)
    expect(rows).toEqual([
      { id: 'u1', isAdmin: false },
      { id: 'u2', isAdmin: false },
    ])
  })

  it('0012 gives every existing episode its own short slug', async () => {
    const pg = new PGlite()
    await migrateUntil(pg, tagOf('0012'))
    await pg.query(`insert into "user" (id, email) values ('u1', 'u@example.com')`)
    await pg.query(`insert into podcast (id, "userId", title, slug) values ('p1', 'u1', 'Podcast', 'podcast')`)
    await pg.query(
      `insert into episode (id, "podcastId", title, slug) select 'e' || n, 'p1', 'Episode', 'episode-' || n from generate_series(1, 200) n`,
    )

    await runMigration(pg, tagOf('0012'))

    const { rows } = await pg.query<{ shortSlug: string }>(`select "shortSlug" from episode`)
    expect(rows).toHaveLength(200)
    for (const { shortSlug } of rows) expect(shortSlug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/)
    expect(new Set(rows.map((r) => r.shortSlug)).size).toBe(200)
  })
})
