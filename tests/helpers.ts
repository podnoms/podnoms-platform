// Shared helpers for server tests.
import { execFileSync } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import sharp from 'sharp'
import { db as appDb } from '~/server/db/client.server'
import { episodes, podcasts, users, type NewEpisode, type NewPodcast } from '~/server/db/schema'
import type { TestDb } from './db'

// The test database (see setup.ts), typed as what it really is.
export const db = appDb as unknown as TestDb

function hasCommand(command: string) {
  try {
    execFileSync(command, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// Media tests run the real ffmpeg and ffprobe, and are skipped without them.
export const hasFfmpeg = hasCommand('ffmpeg') && hasCommand('ffprobe')

// A sine tone, encoded by ffmpeg according to the file extension.
export async function makeTone(path: string, seconds = 2, extraArgs: string[] = []) {
  await mkdir(dirname(path), { recursive: true })
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, ...extraArgs, path])
  return path
}

export function makeImage(width: number, height: number, format: 'png' | 'jpeg' = 'png') {
  const image = sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } })
  return (format === 'png' ? image.png() : image.jpeg()).toBuffer()
}

export function streamOf(data: Uint8Array | string) {
  // Copied, as Response wants bytes backed by a plain ArrayBuffer.
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  return new Response(bytes).body!
}

export async function createUser(values: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ email: `${crypto.randomUUID()}@example.com`, name: 'Test User', ...values })
    .returning()
  return user!
}

export async function createPodcast(userId: string, values: Partial<NewPodcast> = {}) {
  const slug = values.slug ?? `podcast-${crypto.randomUUID().slice(0, 8)}`
  const [podcast] = await db
    .insert(podcasts)
    .values({ userId, title: 'Test Podcast', slug, ...values })
    .returning()
  return podcast!
}

export async function createEpisode(podcastId: string, values: Partial<NewEpisode> = {}) {
  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId,
      title: 'Test Episode',
      slug: `episode-${crypto.randomUUID().slice(0, 8)}`,
      ...values,
    })
    .returning()
  return episode!
}

type Handler = (context: { request: Request; params: Record<string, string> }) => Promise<Response> | Response

// Calls one of a file route's raw HTTP handlers (`server.handlers`) directly.
export function callRoute(
  route: { options: unknown },
  method: string,
  request: Request,
  params: Record<string, string> = {},
) {
  const handlers = (route.options as { server: { handlers: Record<string, Handler> } }).server.handlers
  return handlers[method]!({ request, params })
}

// An image as if just uploaded through /api/images, ready to be committed.
export async function stageTestImage(userId: string) {
  const { stagedImagePath } = await import('~/server/storage.server')
  const imageId = crypto.randomUUID()
  const path = stagedImagePath(userId, imageId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, await makeImage(10, 10, 'jpeg'))
  return imageId
}

// A stored image, as if committed to a podcast or episode.
export async function storeTestImage() {
  const { imagePath, imageUrl } = await import('~/server/storage.server')
  const imageId = crypto.randomUUID()
  await mkdir(dirname(imagePath(imageId)), { recursive: true })
  await writeFile(imagePath(imageId), await makeImage(10, 10, 'jpeg'))
  return { imageId, url: imageUrl(imageId), path: imagePath(imageId) }
}

export const exists = (path: string) => stat(path).then(() => true, () => false)
