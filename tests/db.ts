// An in-process Postgres (PGlite) with the app's migrations applied, standing
// in for the real database client in tests.
import { readFileSync } from 'node:fs'
import { PGlite, type Transaction } from '@electric-sql/pglite'
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
      postgresConstraint(error)
      throw error
    }
  }

  // Transaction queries bypass this client's query method. Translate wrapped
  // errors too, so conflict handling behaves like the production driver.
  override async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await super.transaction(callback)
    } catch (error) {
      postgresConstraint(error)
      throw error
    }
  }
}

function postgresConstraint(error: unknown) {
  if (typeof error !== 'object' || error === null) return
  if ('cause' in error) postgresConstraint(error.cause)
  const { constraint } = error as { constraint?: string }
  if (constraint) Object.assign(error, { constraint_name: constraint })
}

export async function createTestDb() {
  const db = drizzle(new PostgresJsLikePGlite(), { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })
  // Downloads start without the polite pause between them, which would only
  // slow the tests down; tests of the pause set it themselves.
  await db.execute(
    sql`insert into site_settings (key, value) values ('downloadDelaySeconds', '0') on conflict (key) do update set value = excluded.value`,
  )
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
  await db.execute(sql`truncate "user", auth."account", auth."session", auth."verification_token", "show", "episode", "playback_position", "tag" cascade`)
  // The settings stay (tests put back what they change); the app's own values go.
  await db.execute(sql`delete from site_settings where starts_with(key, '__')`)
}
