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
  it('apply cleanly to an empty database', async () => {
    const pg = new PGlite()
    await migrateUntil(pg)
    const { rows } = await pg.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`)
    expect(rows.map((r) => r.tablename)).toEqual([
      'account',
      'episode',
      'playback_position',
      'podcast',
      'session',
      'user',
      'verificationToken',
    ])
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
})
