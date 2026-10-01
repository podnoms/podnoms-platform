import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { episodeSourcePath, stagedUploadPath, userUploadsDir } from '~/server/storage.server'
import { findUpload, moveUploadToEpisode, receiveFile, saveUpload, UploadError } from '~/server/uploads.server'
import { exists, hasFfmpeg, makeTone, streamOf } from '../../test/helpers'

const dir = join(process.env.MEDIA_DIR!, 'receive-test')

describe('receiveFile', () => {
  it('streams the body to the path', async () => {
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'ok')
    await receiveFile(streamOf('hello'), path, 10)
    expect(await readFile(path, 'utf8')).toBe('hello')
  })

  it('refuses bodies over the limit with 413 and removes the partial file', async () => {
    const path = join(dir, 'big')
    const error = await receiveFile(streamOf('x'.repeat(11)), path, 10).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UploadError)
    expect(error).toMatchObject({ status: 413, message: 'That file is too big to upload' })
    expect(await exists(path)).toBe(false)
  })

  it('refuses empty bodies with 400', async () => {
    const path = join(dir, 'empty')
    await expect(receiveFile(streamOf(''), path, 10)).rejects.toMatchObject({ status: 400, message: 'That file is empty' })
    expect(await exists(path)).toBe(false)
  })
})

describe.skipIf(!hasFfmpeg)('saveUpload', () => {
  const user = 'user-1'

  it("stages the file with its tagged title and duration", async () => {
    const tone = await makeTone(join(dir, 'tagged.mp3'), 2, ['-metadata', 'title=Tagged Title'])
    const upload = await saveUpload(user, streamOf(await readFile(tone)), 'file-name.mp3')
    expect(upload).toEqual({ uploadId: expect.stringMatching(/^[0-9a-f-]{36}$/), title: 'Tagged Title', durationSeconds: 2 })
    expect(await exists(stagedUploadPath(user, upload.uploadId))).toBe(true)
    expect(await findUpload(user, upload.uploadId)).toEqual(upload)
  })

  it('titles untagged files by their name without the extension', async () => {
    const tone = await makeTone(join(dir, 'plain.wav'), 1)
    const upload = await saveUpload(user, streamOf(await readFile(tone)), '  My Mix.final.wav')
    expect(upload.title).toBe('My Mix.final')
  })

  it('falls back to "Untitled episode" without a usable name', async () => {
    const tone = await makeTone(join(dir, 'plain2.wav'), 1)
    expect((await saveUpload(user, streamOf(await readFile(tone)), '')).title).toBe('Untitled episode')
  })

  it('refuses files without audio with 415 and keeps nothing', async () => {
    const before = await readdir(userUploadsDir(user)).catch(() => [])
    await expect(saveUpload(user, streamOf('not audio at all'), 'x.mp3')).rejects.toMatchObject({ status: 415 })
    expect(await readdir(userUploadsDir(user))).toEqual(before)
  })
})

describe('findUpload', () => {
  it("returns null for unknown uploads", async () => {
    expect(await findUpload('user-1', crypto.randomUUID())).toBeNull()
  })

  it('is scoped to the user who uploaded', async () => {
    const uploadId = crypto.randomUUID()
    await mkdir(userUploadsDir('owner'), { recursive: true })
    await writeFile(`${stagedUploadPath('owner', uploadId)}.json`, JSON.stringify({ uploadId, title: 't', durationSeconds: 1 }))
    expect(await findUpload('owner', uploadId)).not.toBeNull()
    expect(await findUpload('someone-else', uploadId)).toBeNull()
  })
})

describe('moveUploadToEpisode', () => {
  it('moves the file to the episode sources and removes its metadata', async () => {
    const uploadId = crypto.randomUUID()
    const path = stagedUploadPath('mover', uploadId)
    await mkdir(userUploadsDir('mover'), { recursive: true })
    await writeFile(path, 'audio')
    await writeFile(`${path}.json`, '{}')
    await moveUploadToEpisode('mover', uploadId, 'episode-1')
    expect(await readFile(episodeSourcePath('episode-1'), 'utf8')).toBe('audio')
    expect(await exists(path)).toBe(false)
    expect(await exists(`${path}.json`)).toBe(false)
  })
})
