// An in-process Postgres (PGlite) with the app's migrations applied, standing
// in for the real database client in tests.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '~/server/db/schema'

export type TestDb = PgliteDatabase<typeof schema> & { $client: PGlite }

// PGlite reports a violated constraint as `constraint`; postgres.js, which the
// app uses, as `constraint_name` (see isSlugConflict). Errors are given both.
class PostgresJsLikePGlite extends PGlite {
  override async query<T>(...args: Parameters<PGlite['query']>) {
    try {
      return await super.query<T>(...args)
    } catch (error) {
      const { constraint } = error as { constraint?: string }
      if (constraint) Object.assign(error as object, { constraint_name: constraint })
      throw error
    }
  }
}

export async function createTestDb() {
  const db = drizzle(new PostgresJsLikePGlite(), { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })
  return db
}

// The migration files, in order, each split into statements as drizzle-kit runs them.
export function migrationStatements() {
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] }
  return journal.entries.map(({ tag }) => ({
    tag,
    statements: readFileSync(`drizzle/${tag}.sql`, 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean),
  }))
}

// Empties every table between tests. Refuses to touch anything but the
// in-process database, in case the tests are run without tests/setup.ts.
export async function resetDb(db: TestDb) {
  if (!(db.$client instanceof PGlite)) {
    throw new Error('resetDb was given a real database; run the tests with `bun run test`')
  }
  await db.execute(sql`truncate "user", "account", "session", "verification_token", "podcast", "episode", "playback_position" cascade`)
}
