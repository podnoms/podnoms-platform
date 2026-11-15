import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  audioPath,
  downloadTemplate,
  episodeAudioPath,
  episodeMasterPath,
  isDownloadOf,
  replacementAudioName,
  replacementAudioPath,
  episodeAudioUrl,
  episodeSourcePath,
  episodeWaveformPath,
  imagePath,
  imageUrl,
  imageVariantPath,
  removeStaleFiles,
  stagedImagePath,
  stagedUploadPath,
  userUploadsDir,
} from '~/server/storage.server'

const media = process.env.MEDIA_DIR!

describe('paths', () => {
  it('keeps every file under MEDIA_DIR', () => {
    expect(episodeAudioPath('e1')).toBe(join(media, 'audio', 'e1.mp3'))
    expect(episodeWaveformPath('e1')).toBe(join(media, 'waveforms', 'e1.json'))
    expect(episodeSourcePath('e1')).toBe(join(media, 'sources', 'e1'))
    expect(userUploadsDir('u1')).toBe(join(media, 'uploads', 'u1'))
    expect(stagedUploadPath('u1', 'up1')).toBe(join(media, 'uploads', 'u1', 'up1'))
    expect(imagePath('i1')).toBe(join(media, 'images', 'i1.jpg'))
    expect(imageVariantPath('i1', 256, 'webp')).toBe(join(media, 'images', 'variants', 'i1-256.webp'))
    expect(stagedImagePath('u1', 'i1')).toBe(join(media, 'staged-images', 'u1', 'i1.jpg'))
  })

  it('builds public URLs', () => {
    expect(episodeAudioUrl('e1')).toBe('/api/episodes/e1/audio')
    expect(imageUrl('i1')).toBe('/images/i1.jpg')
  })

  it.each(['../etc/passwd', 'a/b', 'a.b', '', 'a b'])('refuses unsafe ID %j', (id) => {
    expect(() => userUploadsDir(id)).toThrow('Invalid ID')
    expect(() => stagedUploadPath('u1', id)).toThrow('Invalid ID')
    expect(() => episodeSourcePath(id)).toThrow('Invalid ID')
    expect(() => episodeWaveformPath(id)).toThrow('Invalid ID')
    expect(() => imagePath(id)).toThrow('Invalid ID')
    expect(() => imageVariantPath(id, 64, 'jpg')).toThrow('Invalid ID')
    expect(() => stagedImagePath(id, 'i1')).toThrow('Invalid ID')
    expect(() => episodeAudioPath(id)).toThrow('Invalid ID')
    expect(() => replacementAudioPath(id)).toThrow('Invalid ID')
    expect(() => episodeMasterPath(id)).toThrow('Invalid ID')
    expect(() => audioPath(id)).toThrow('Invalid ID')
    expect(() => downloadTemplate(id)).toThrow('Invalid ID')
  })

  it("names an episode's audio by its ID, or as its replacement, and nothing else", () => {
    expect(episodeMasterPath('e1')).toBe(join(media, 'masters', 'e1.mka'))
    expect(episodeMasterPath(replacementAudioName('e1'))).toBe(join(media, 'masters', 'e1.replacement.mka'))
    expect(audioPath(replacementAudioName('e1'))).toBe(replacementAudioPath('e1'))
    expect(() => audioPath('e1.replacement/../../x')).toThrow('Invalid ID')
    expect(() => episodeMasterPath('e1.other')).toThrow('Invalid ID')
  })

  it('only believes a download is where it was told to save it', () => {
    const audio = join(media, 'audio')
    expect(downloadTemplate('e1')).toBe(join(audio, 'e1.download.%(ext)s'))
    expect(isDownloadOf('e1', join(audio, 'e1.download.webm'))).toBe(true)
    expect(isDownloadOf('e1.replacement', join(audio, 'e1.replacement.download.m4a'))).toBe(true)
    expect(isDownloadOf('e1', join(audio, 'e2.download.webm'))).toBe(false)
    expect(isDownloadOf('e1', join(audio, 'e1.mp3'))).toBe(false)
    expect(isDownloadOf('e1', join(audio, '..', 'masters', 'e1.download.webm'))).toBe(false)
    expect(isDownloadOf('e1', join(audio, 'sub', 'e1.download.webm'))).toBe(false)
    expect(isDownloadOf('e1', '/etc/e1.download.webm')).toBe(false)
    expect(isDownloadOf('e1', join(audio, 'e1.download.webm.part'))).toBe(false)
  })

  it('accepts UUIDs and other plain IDs', () => {
    expect(() => imagePath(crypto.randomUUID())).not.toThrow()
    expect(() => imagePath('abc_DEF-123')).not.toThrow()
  })
})

describe('removeStaleFiles', () => {
  it('deletes files untouched for over a day and keeps the rest', async () => {
    const dir = join(media, 'stale-test')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'old'), 'x')
    await writeFile(join(dir, 'new'), 'x')
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    await utimes(join(dir, 'old'), twoDaysAgo, twoDaysAgo)
    await removeStaleFiles(dir)
    expect(await readdir(dir)).toEqual(['new'])
  })
})
