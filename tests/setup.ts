// Runs before each test file, ahead of its imports, so src/env.ts sees these.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, vi } from 'vitest'

const env = process.env as Record<string, string | undefined>
// Never used to connect: the database client is replaced by an in-process one below.
env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
env.AUTH_SECRET = 'test-secret-that-is-at-least-32-characters-long'
// Each test file gets its own media folder.
const mediaDir = (env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'podnoms-test-')))
afterAll(() => rmSync(mediaDir, { recursive: true, force: true }))
env.YTDLP_PATH = resolve(import.meta.dirname, 'fixtures/fake-yt-dlp.mjs')
// Keep a developer's .env (which bun loads) out of the tests.
for (const name of ['AUTH_URL', 'AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET', 'AUTH_FACEBOOK_ID', 'AUTH_FACEBOOK_SECRET', 'FFMPEG_PATH', 'FFPROBE_PATH']) {
  delete env[name]
}

// Server code gets a fresh, migrated, in-memory Postgres per test file. The
// factory only runs for files that (indirectly) import the database.
vi.mock('~/server/db/client.server', async () => {
  const { createTestDb } = await import('./db')
  return { db: await createTestDb() }
})
