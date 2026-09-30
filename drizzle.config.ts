import { defineConfig } from 'drizzle-kit'

// `bun run db:*` loads .env automatically, so DATABASE_URL comes from there.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL },
})
