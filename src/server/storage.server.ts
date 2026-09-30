import '@tanstack/react-start/server-only'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { env } from '~/env'

const audioDir = resolve(env.STORAGE_DIR, 'audio')

export async function ensureAudioDir() {
  await mkdir(audioDir, { recursive: true })
  return audioDir
}

export function episodeAudioPath(episodeId: string) {
  return join(audioDir, `${episodeId}.mp3`)
}

export function episodeAudioUrl(episodeId: string) {
  return `/api/episodes/${episodeId}/audio`
}
