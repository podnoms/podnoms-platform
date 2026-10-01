import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { episodeAudioPath, episodeWaveformPath } from '~/server/storage.server'
import { backfillWaveforms, computeWaveform, deleteWaveform, readWaveform, saveWaveform } from '~/server/waveforms.server'
import { resetDb } from '../../test/db'
import { createEpisode, createPodcast, createUser, db, exists, hasFfmpeg, makeTone } from '../../test/helpers'

const dir = join(process.env.MEDIA_DIR!, 'waveform-test')

describe.skipIf(!hasFfmpeg)('computeWaveform', () => {
  it('measures long audio as 1000 bars scaled to 0–255', async () => {
    const waveform = await computeWaveform(await makeTone(join(dir, 'long.wav'), 25))
    expect(waveform.version).toBe(1)
    expect(waveform.peaks).toHaveLength(1000)
    expect(waveform.rms).toHaveLength(1000)
    for (const value of [...waveform.peaks, ...waveform.rms]) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(255)
    }
    // A steady tone is equally loud throughout.
    expect(Math.min(...waveform.rms)).toBeGreaterThan(240)
  })

  it('uses one bar per 20ms window for short audio', async () => {
    const waveform = await computeWaveform(await makeTone(join(dir, 'short.wav'), 2))
    expect(waveform.peaks).toHaveLength(100)
  })

  it('shows silence as quieter than sound', async () => {
    const path = join(dir, 'half-silent.wav')
    await mkdir(dir, { recursive: true })
    // 2s of tone, then 2s of silence.
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-af', 'apad=pad_dur=2', path])
    const { rms } = await computeWaveform(path)
    expect(rms[10]).toBeGreaterThan(240)
    expect(rms.at(-10)).toBe(0)
  })

  it('is all zeros for pure silence', async () => {
    const path = join(dir, 'silent.wav')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '1', path])
    const { peaks, rms } = await computeWaveform(path)
    expect(new Set([...peaks, ...rms])).toEqual(new Set([0]))
  })

  it("rejects with ffmpeg's error for unreadable files", async () => {
    await expect(computeWaveform(join(dir, 'missing.wav'))).rejects.toThrow(/No such file/)
  })
})

describe.skipIf(!hasFfmpeg)('saveWaveform / readWaveform / deleteWaveform', () => {
  it("saves, reads and deletes an episode's waveform", async () => {
    await makeTone(episodeAudioPath('wave-ep'), 1)
    expect(await readWaveform('wave-ep')).toBeNull()
    await saveWaveform('wave-ep')
    expect((await readWaveform('wave-ep'))?.rms).toHaveLength(50)
    await deleteWaveform('wave-ep')
    expect(await readWaveform('wave-ep')).toBeNull()
    await expect(deleteWaveform('wave-ep')).resolves.toBeUndefined()
  })

  it('returns null for a corrupt waveform file', async () => {
    const path = episodeWaveformPath('corrupt')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{nope')
    expect(await readWaveform('corrupt')).toBeNull()
  })
})

describe.skipIf(!hasFfmpeg)('backfillWaveforms', () => {
  beforeEach(() => resetDb(db))

  it('makes missing waveforms for ready episodes only, once', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const ready = await createEpisode(podcast.id, { status: 'ready' })
    const pending = await createEpisode(podcast.id, { status: 'pending' })
    const broken = await createEpisode(podcast.id, { status: 'ready' })
    await makeTone(episodeAudioPath(ready.id), 1)
    await makeTone(episodeAudioPath(pending.id), 1)
    // `broken` has no audio: it's logged and skipped, not fatal.

    await backfillWaveforms()
    expect(await exists(episodeWaveformPath(ready.id))).toBe(true)
    expect(await exists(episodeWaveformPath(pending.id))).toBe(false)
    expect(await exists(episodeWaveformPath(broken.id))).toBe(false)

    // It only ever runs once per server process.
    await makeTone(episodeAudioPath(broken.id), 1)
    await backfillWaveforms()
    expect(await exists(episodeWaveformPath(broken.id))).toBe(false)
  })
})
