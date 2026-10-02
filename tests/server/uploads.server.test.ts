import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { episodeSourcePath, stagedUploadPath, userUploadsDir } from '~/server/storage.server'
import { findUpload, moveUploadToEpisode, receiveFile, saveUpload, saveUploadPart, UploadError } from '~/server/uploads.server'
import { exists, hasFfmpeg, makeTone, streamOf } from '../helpers'

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

describe('receiveFile at an offset', () => {
  it('writes from the offset, replacing anything after it', async () => {
    const path = join(dir, 'offset')
    await mkdir(dir, { recursive: true })
    await writeFile(path, 'abcdefgh')
    expect(await receiveFile(streamOf('XY'), path, 10, 3)).toBe(2)
    expect(await readFile(path, 'utf8')).toBe('abcXY')
  })

  it('keeps the file up to the offset when the part is refused', async () => {
    const path = join(dir, 'offset-big')
    await writeFile(path, 'abc')
    await expect(receiveFile(streamOf('x'.repeat(5)), path, 4, 3)).rejects.toMatchObject({ status: 413 })
    expect(await readFile(path, 'utf8')).toBe('abc')
  })
})

describe('saveUploadPart', () => {
  const user = 'part-user'
  const part = (offset: number, size: number, uploadId?: string) => ({ uploadId, offset, size, filename: 'show.mp3' })

  it('starts an upload with the first part and adds later ones to it', async () => {
    const first = await saveUploadPart(user, streamOf('abc'), part(0, 10))
    expect(first).toEqual({ uploadId: expect.stringMatching(/^[0-9a-f-]{36}$/), received: 3 })
    const second = await saveUploadPart(user, streamOf('def'), part(3, 10, first.uploadId))
    expect(second).toEqual({ uploadId: first.uploadId, received: 6 })
    expect(await readFile(stagedUploadPath(user, first.uploadId), 'utf8')).toBe('abcdef')
    expect(await findUpload(user, first.uploadId)).toBeNull()
  })

  it('accepts a part sent again', async () => {
    const { uploadId } = await saveUploadPart(user, streamOf('abc'), part(0, 10))
    await saveUploadPart(user, streamOf('def'), part(3, 10, uploadId))
    expect(await saveUploadPart(user, streamOf('DEF'), part(3, 10, uploadId))).toEqual({ uploadId, received: 6 })
    expect(await readFile(stagedUploadPath(user, uploadId), 'utf8')).toBe('abcDEF')
  })

  it('refuses a part that skips ahead with 409', async () => {
    const { uploadId } = await saveUploadPart(user, streamOf('abc'), part(0, 10))
    await expect(saveUploadPart(user, streamOf('x'), part(5, 10, uploadId))).rejects.toMatchObject({ status: 409 })
  })

  it("refuses parts for uploads that don't exist with 404", async () => {
    await expect(saveUploadPart(user, streamOf('x'), part(3, 10, crypto.randomUUID()))).rejects.toMatchObject({ status: 404 })
  })

  it('refuses parts that go past the declared size with 413', async () => {
    const { uploadId } = await saveUploadPart(user, streamOf('abc'), part(0, 5))
    await expect(saveUploadPart(user, streamOf('defg'), part(3, 5, uploadId))).rejects.toMatchObject({ status: 413 })
    expect(await readFile(stagedUploadPath(user, uploadId), 'utf8')).toBe('abc')
  })

  it('refuses sizes over the limit, and nonsense offsets and IDs', async () => {
    await expect(saveUploadPart(user, streamOf('x'), part(0, 2 * 1024 ** 3))).rejects.toMatchObject({ status: 413 })
    await expect(saveUploadPart(user, streamOf('x'), part(0, 0))).rejects.toMatchObject({ status: 400 })
    await expect(saveUploadPart(user, streamOf('x'), part(3, 10))).rejects.toMatchObject({ status: 400 })
    await expect(saveUploadPart(user, streamOf('x'), part(10, 10, 'u1'))).rejects.toMatchObject({ status: 400 })
    await expect(saveUploadPart(user, streamOf('x'), part(NaN, 10, 'u1'))).rejects.toMatchObject({ status: 400 })
    await expect(saveUploadPart(user, streamOf('x'), part(3, 10, '../escape'))).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a finished file without audio with 415 and keeps nothing', async () => {
    const { uploadId } = await saveUploadPart(user, streamOf('not '), part(0, 9))
    await expect(saveUploadPart(user, streamOf('audio'), part(4, 9, uploadId))).rejects.toMatchObject({ status: 415 })
    expect(await exists(stagedUploadPath(user, uploadId))).toBe(false)
  })

  it.skipIf(!hasFfmpeg)('checks the file once the last part is in', async () => {
    const audio = await readFile(await makeTone(join(dir, 'parts.wav'), 1))
    const middle = Math.floor(audio.length / 2)
    const first = await saveUploadPart(user, streamOf(audio.subarray(0, middle)), part(0, audio.length))
    const upload = await saveUploadPart(user, streamOf(audio.subarray(middle)), part(middle, audio.length, first.uploadId))
    expect(upload).toEqual({ uploadId: first.uploadId, title: 'show', durationSeconds: 1 })
    expect(await findUpload(user, first.uploadId)).toEqual(upload)
    await expect(saveUploadPart(user, streamOf('x'), part(1, audio.length, first.uploadId))).rejects.toMatchObject({ status: 409 })
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
