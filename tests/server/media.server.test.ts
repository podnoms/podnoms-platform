import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { convertToMp3, decodeImageToPng, extractMaster, hlsRenditions, probeAudio, probeStream } from '~/server/media.server'
import { hasFfmpeg, makeImage, makeTone } from '../helpers'

const dir = join(process.env.MEDIA_DIR!, 'media-test')

const bitrate = (path: string) =>
  execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=bit_rate', '-of', 'csv=p=0', path], {
    encoding: 'utf8',
  }).trim()

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
  it('encodes other formats to 320k MP3, reporting progress up to 1', async () => {
    const source = await makeTone(join(dir, 'source.wav'), 3)
    const destination = join(dir, 'converted.mp3')
    const onProgress = vi.fn()
    await convertToMp3(source, destination, (await probeAudio(source))!, onProgress)
    expect(await probeAudio(destination)).toMatchObject({ codec: 'mp3', durationSeconds: 3 })
    expect(bitrate(destination)).toBe('320000')
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
    expect(bitrate(destination)).toBe(bitrate(source))
  })

  it("rejects with ffmpeg's last error line", async () => {
    await expect(
      convertToMp3(join(dir, 'does-not-exist.wav'), join(dir, 'x.mp3'), { codec: 'pcm', durationSeconds: 1, title: null }, () => {}),
    ).rejects.toThrow(/No such file or directory/)
  })
})

describe.skipIf(!hasFfmpeg)('extractMaster', () => {
  it("copies a video's first audio track, untouched, leaving the video", async () => {
    const source = join(dir, 'video.mkv')
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'mpeg4', '-c:a', 'libmp3lame', '-b:a', '96k', '-shortest', source,
    ])
    const master = join(dir, 'master.mka')
    await extractMaster(source, master)
    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', master], { encoding: 'utf8' })
    expect(streams.trim()).toBe('mp3,audio')
    expect(await probeStream(master)).toMatchObject({ codec: 'mp3', channels: 1, durationSeconds: 2 })
  })
})

describe('hlsRenditions', () => {
  it('makes every bitrate from a high-bitrate source', () => {
    expect(hlsRenditions({ codec: 'aac', bitrate: 320_000, channels: 2 }).map((r) => r.name)).toEqual(['96k', '160k', '256k'])
  })

  it("doesn't make bitrates well above the source's, but always the lowest", () => {
    expect(hlsRenditions({ codec: 'mp3', bitrate: 128_000, channels: 2 }).map((r) => r.name)).toEqual(['96k', '160k'])
    expect(hlsRenditions({ codec: 'mp3', bitrate: 40_000, channels: 2 }).map((r) => r.name)).toEqual(['96k'])
  })

  it('makes mono at half the rates', () => {
    expect(hlsRenditions({ codec: 'aac', bitrate: null, channels: 1 })).toEqual([
      { name: '48k', bitrate: 48_000, channels: 1 },
      { name: '80k', bitrate: 80_000, channels: 1 },
      { name: '128k', bitrate: 128_000, channels: 1 },
    ])
  })

  it('makes every bitrate from a lossless source, however small it is', () => {
    expect(hlsRenditions({ codec: 'flac', bitrate: 30_000, channels: 2 })).toHaveLength(3)
    expect(hlsRenditions({ codec: 'pcm_s16le', bitrate: 1_411_000, channels: 2 })).toHaveLength(3)
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
