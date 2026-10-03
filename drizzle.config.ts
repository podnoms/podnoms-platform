import { defineConfig } from 'drizzle-kit'

// `bun run db:*` loads .env automatically, so DATABASE_URL comes from there.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')

// The migrator creates its own schema and table "if not exists" on every run,
// which makes Postgres send a notice each time they already do. Unknown URL
// parameters become session settings in postgres.js, so this keeps those quiet.
const url = new URL(process.env.DATABASE_URL)
url.searchParams.set('client_min_messages', 'warning')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: url.toString() },
})
