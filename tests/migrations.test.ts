// The migrations in drizzle/, applied to an empty database.
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { migrationStatements } from './db'

describe('migrations', () => {
  it('apply cleanly to an empty database', async () => {
    const pg = new PGlite()
    try {
      for (const { statements } of migrationStatements()) {
        for (const statement of statements) await pg.exec(statement)
      }
      const { rows } = await pg.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public' order by 1`,
      )
      expect(rows.map((r) => r.tablename)).toEqual([
        'account',
        'episode',
        'playback_position',
        'podcast',
        'recovery_code',
        'security_key',
        'session',
        'user',
        'verification_token',
      ])
    } finally {
      await pg.close()
    }
  })
})
