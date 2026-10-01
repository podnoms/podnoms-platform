// Audio files uploaded to become episodes. A file is uploaded first and
// checked with ffprobe, so the form can show its title; it becomes an episode
// when the form is submitted.
import '@tanstack/react-start/server-only'
import { createWriteStream } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { maxUploadBytes } from '~/lib/episode-schema'
import { probeAudio } from '~/server/media.server'
import {
  ensureSourcesDir,
  ensureUserUploadsDir,
  episodeSourcePath,
  removeStaleFiles,
  stagedUploadPath,
} from '~/server/storage.server'

export type UploadedAudio = {
  uploadId: string
  // The file's tagged title, or its name without the extension.
  title: string
  durationSeconds: number | null
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

// Streams a request body to disk, refusing it if it's empty or too big.
export async function receiveFile(body: ReadableStream<Uint8Array>, path: string, maxBytes: number) {
  let received = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > maxBytes) callback(new UploadError('That file is too big to upload', 413))
      else callback(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), limit, createWriteStream(path))
    if (received === 0) throw new UploadError('That file is empty', 400)
  } catch (error) {
    await rm(path, { force: true })
    throw error
  }
}

const metadataPath = (path: string) => `${path}.json`

export async function saveUpload(userId: string, body: ReadableStream<Uint8Array>, filename: string) {
  const dir = await ensureUserUploadsDir(userId)
  void removeStaleFiles(dir).catch(() => {})

  const uploadId = crypto.randomUUID()
  const path = stagedUploadPath(userId, uploadId)
  try {
    await receiveFile(body, path, maxUploadBytes)
    const info = await probeAudio(path)
    if (!info) throw new UploadError("That file doesn't contain any audio we can read", 415)
    const upload: UploadedAudio = {
      uploadId,
      title: info.title ?? (basename(filename, extname(filename)).trim() || 'Untitled episode'),
      durationSeconds: info.durationSeconds,
    }
    await writeFile(metadataPath(path), JSON.stringify(upload))
    return upload
  } catch (error) {
    await rm(path, { force: true })
    throw error
  }
}

// The user's upload, if it's still waiting to become an episode.
export async function findUpload(userId: string, uploadId: string) {
  try {
    const json = await readFile(metadataPath(stagedUploadPath(userId, uploadId)), 'utf8')
    return JSON.parse(json) as UploadedAudio
  } catch {
    return null
  }
}

// Hands the uploaded file to the episode, for the processor to convert.
export async function moveUploadToEpisode(userId: string, uploadId: string, episodeId: string) {
  const path = stagedUploadPath(userId, uploadId)
  await ensureSourcesDir()
  await rename(path, episodeSourcePath(episodeId))
  await rm(metadataPath(path), { force: true })
}
