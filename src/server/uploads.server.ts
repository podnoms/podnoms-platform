// Audio files uploaded to become episodes. A file is uploaded first and
// checked with ffprobe, so the form can show its title; it becomes an episode
// when the form is submitted.
import '@tanstack/react-start/server-only'
import { createWriteStream } from 'node:fs'
import { readFile, rename, rm, stat, truncate, writeFile } from 'node:fs/promises'
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

// Streams a request body to disk, refusing it if it's empty or too big, and
// returns how many bytes it held. With an offset, the body is written into the
// existing file from there (one part of a chunked upload), and a failure leaves
// the file as it was up to the offset so the part can be sent again.
export async function receiveFile(body: ReadableStream<Uint8Array>, path: string, maxBytes: number, offset = 0) {
  let received = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > maxBytes) callback(new UploadError('That file is too big to upload', 413))
      else callback(null, chunk)
    },
  })
  const file = offset > 0 ? createWriteStream(path, { flags: 'r+', start: offset }) : createWriteStream(path)
  try {
    await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), limit, file)
    if (received === 0) throw new UploadError('That file is empty', 400)
    // A part sent again may be shorter than what was written there before.
    if (offset > 0) await truncate(path, offset + received)
    return received
  } catch (error) {
    if (offset > 0) await truncate(path, offset).catch(() => {})
    else await rm(path, { force: true })
    throw error
  }
}

const metadataPath = (path: string) => `${path}.json`

async function startUpload(userId: string) {
  const dir = await ensureUserUploadsDir(userId)
  void removeStaleFiles(dir).catch(() => {})
  return crypto.randomUUID()
}

// Checks the received file is audio and records it as ready to become an episode.
async function finishUpload(userId: string, uploadId: string, filename: string) {
  const path = stagedUploadPath(userId, uploadId)
  try {
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

// Receives a whole file in one request.
export async function saveUpload(userId: string, body: ReadableStream<Uint8Array>, filename: string) {
  const uploadId = await startUpload(userId)
  await receiveFile(body, stagedUploadPath(userId, uploadId), maxUploadBytes)
  return finishUpload(userId, uploadId, filename)
}

export type UploadPart = {
  // Missing for the first part; the response to it gives the ID for the rest.
  uploadId?: string
  // Where this part starts in the file, and the size of the whole file.
  offset: number
  size: number
  filename: string
}

export type UploadPartReceived = { uploadId: string; received: number }

// Receives one part of a file sent in several requests, as Cloudflare (in front
// of production) refuses request bodies over 100 MB. Parts are sent in order;
// one can be sent again if its response was lost. Once the last part is in,
// the file is checked as with saveUpload.
export async function saveUploadPart(
  userId: string,
  body: ReadableStream<Uint8Array>,
  part: UploadPart,
): Promise<UploadPartReceived | UploadedAudio> {
  const { offset, size, filename } = part
  if (!Number.isSafeInteger(size) || size <= 0) throw new UploadError('That file is empty', 400)
  if (size > maxUploadBytes) throw new UploadError('That file is too big to upload', 413)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) throw new UploadError('Invalid upload offset', 400)

  let uploadId = part.uploadId
  if (!uploadId) {
    if (offset > 0) throw new UploadError('Invalid upload offset', 400)
    uploadId = await startUpload(userId)
  } else {
    if (!/^[\w-]+$/.test(uploadId)) throw new UploadError('Invalid upload', 400)
    if (await findUpload(userId, uploadId)) throw new UploadError('That upload is already finished', 409)
  }

  const path = stagedUploadPath(userId, uploadId)
  if (offset > 0) {
    const current = await stat(path).then((s) => s.size, () => null)
    if (current === null) throw new UploadError('That upload has expired. Please try again.', 404)
    if (current < offset) throw new UploadError('Part of the upload is missing. Please try again.', 409)
  }
  const received = offset + (await receiveFile(body, path, size - offset, offset))
  if (received < size) return { uploadId, received }
  return finishUpload(userId, uploadId, filename)
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
