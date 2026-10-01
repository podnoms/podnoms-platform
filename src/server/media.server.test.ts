import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { convertToMp3, decodeImageToPng, probeAudio } from '~/server/media.server'
import { hasFfmpeg, makeImage, makeTone } from '../../test/helpers'

const dir = join(process.env.MEDIA_DIR!, 'media-test')

describe.skipIf(!hasFfmpeg)('probeAudio', () => {
  it('reads the codec, rounded duration and tagged title', async () => {
    const path = await makeTone(join(dir, 'tagged.mp3'), 3, ['-metadata', 'title=  My Song  '])
    expect(await probeAudio(path)).toEqual({ codec: 'mp3', durationSeconds: 3, title: 'My Song' })
  })

  it('reports a missing title as null', async () => {
    const path = await makeTone(join(dir, 'plain.wav'), 1)
    expect(await probeAudio(path)).toEqual({ codec: 'pcm_s16le', durationSeconds: 1, title: null })
  })

  it('returns null for files without audio', async () => {
    const text = join(dir, 'notes.txt')
    await writeFile(text, 'not audio')
    expect(await probeAudio(text)).toBeNull()
    const image = join(dir, 'image.png')
    await writeFile(image, await makeImage(8, 8))
    expect(await probeAudio(image)).toBeNull()
    expect(await probeAudio(join(dir, 'missing.mp3'))).toBeNull()
  })
})

describe.skipIf(!hasFfmpeg)('convertToMp3', () => {
  it('encodes other formats to MP3, reporting progress up to 1', async () => {
    const source = await makeTone(join(dir, 'source.wav'), 3)
    const destination = join(dir, 'converted.mp3')
    const onProgress = vi.fn()
    await convertToMp3(source, destination, (await probeAudio(source))!, onProgress)
    expect(await probeAudio(destination)).toMatchObject({ codec: 'mp3', durationSeconds: 3 })
    const fractions = onProgress.mock.calls.map(([fraction]) => fraction as number)
    expect(fractions.length).toBeGreaterThan(0)
    expect(fractions.every((f) => f >= 0 && f <= 1)).toBe(true)
  })

  it("doesn't report progress when the duration is unknown", async () => {
    const source = await makeTone(join(dir, 'unknown.wav'), 1)
    const onProgress = vi.fn()
    await convertToMp3(source, join(dir, 'unknown.mp3'), { codec: 'pcm_s16le', durationSeconds: null, title: null }, onProgress)
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('copies MP3 audio rather than re-encoding it', async () => {
    const source = await makeTone(join(dir, 'already.mp3'), 2, ['-b:a', '32k'])
    const destination = join(dir, 'copied.mp3')
    await convertToMp3(source, destination, (await probeAudio(source))!, () => {})
    const bitrate = (path: string) =>
      execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=bit_rate', '-of', 'csv=p=0', path], { encoding: 'utf8' }).trim()
    expect(bitrate(destination)).toBe(bitrate(source))
  })

  it("rejects with ffmpeg's last error line", async () => {
    await expect(
      convertToMp3(join(dir, 'does-not-exist.wav'), join(dir, 'x.mp3'), { codec: 'pcm', durationSeconds: 1, title: null }, () => {}),
    ).rejects.toThrow(/No such file or directory/)
  })
})

describe.skipIf(!hasFfmpeg)('decodeImageToPng', () => {
  it('decodes an image to PNG', async () => {
    const source = join(dir, 'in.jpg')
    await writeFile(source, await makeImage(16, 16, 'jpeg'))
    const destination = join(dir, 'out.png')
    await decodeImageToPng(source, destination)
    expect(await sharp(destination).metadata()).toMatchObject({ format: 'png', width: 16, height: 16 })
  })
})
