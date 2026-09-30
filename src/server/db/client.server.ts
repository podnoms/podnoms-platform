import '@tanstack/react-start/server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '~/env'
import * as schema from '~/server/db/schema'

// Reuse one connection pool across dev-server reloads.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> }
const client = globalForDb.pg ?? postgres(env.DATABASE_URL)
if (process.env.NODE_ENV !== 'production') globalForDb.pg = client

export const db = drizzle(client, { schema })
