// Waveforms of episode audio, Mixcloud style: the loudness of the episode
// across its length, as a row of bars. Made once when an episode is processed
// and kept as JSON in the media folder.
import '@tanstack/react-start/server-only'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import { env } from '~/env'
import { db } from '~/server/db/client.server'
import { episodes } from '~/server/db/schema'
import { episodeAudioPath, episodeWaveformPath } from '~/server/storage.server'

export type Waveform = {
  version: 1
  // One value per bar, from the start of the episode to the end, each 0–255
  // relative to the loudest bars. Peaks are the loudest moment in each bar and
  // look spiky; RMS is the average loudness and looks smoother.
  peaks: number[]
  rms: number[]
}

// Enough bars for a full-width player; draw fewer by combining neighbours.
const bars = 1000
// Audio is analysed as mono at a low sample rate: plenty for loudness, and fast.
const sampleRate = 8000
// Loudness is first measured over short windows, which are then combined into
// bars once the length is known.
const windowSamples = sampleRate / 50

// Decodes the audio with ffmpeg and measures it. Takes a few seconds per hour of audio.
export function computeWaveform(audioPath: string) {
  return new Promise<Waveform>((resolve, reject) => {
    const child = spawn(
      env.FFMPEG_PATH,
      ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', audioPath, '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const windowPeaks: number[] = []
    const windowSquares: number[] = []
    let peak = 0
    let squares = 0
    let count = 0
    // A sample can be split across chunks.
    let leftover: Buffer | null = null

    child.stdout.on('data', (chunk: Buffer) => {
      const data = leftover ? Buffer.concat([leftover, chunk]) : chunk
      const usable = data.length - (data.length % 2)
      leftover = usable < data.length ? data.subarray(usable) : null
      for (let offset = 0; offset < usable; offset += 2) {
        const sample = data.readInt16LE(offset) / 32768
        peak = Math.max(peak, Math.abs(sample))
        squares += sample * sample
        if (++count === windowSamples) {
          windowPeaks.push(peak)
          windowSquares.push(squares)
          peak = squares = count = 0
        }
      }
    })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-2000)))
    child.on('error', (error) => reject(new Error(`Could not run ffmpeg: ${error.message}`)))
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim().split('\n').at(-1) || `ffmpeg exited with code ${code}`))
      if (count) {
        windowPeaks.push(peak)
        windowSquares.push(squares)
      }
      resolve(toBars(windowPeaks, windowSquares))
    })
  })
}

function toBars(windowPeaks: number[], windowSquares: number[]): Waveform {
  const total = windowPeaks.length
  const count = Math.min(bars, total)
  const peaks: number[] = []
  const rms: number[] = []
  for (let bar = 0; bar < count; bar++) {
    const start = Math.floor((bar * total) / count)
    const end = Math.floor(((bar + 1) * total) / count)
    let barPeak = 0
    let barSquares = 0
    for (let i = start; i < end; i++) {
      barPeak = Math.max(barPeak, windowPeaks[i]!)
      barSquares += windowSquares[i]!
    }
    peaks.push(barPeak)
    rms.push(Math.sqrt(barSquares / ((end - start) * windowSamples)))
  }
  return { version: 1, peaks: scale(peaks), rms: scale(rms) }
}

// Scales values to 0–255, rounded to whole numbers to keep the JSON small.
// The top of the scale is the 99th percentile rather than the maximum, so a
// single click or clipped moment doesn't flatten the rest; louder bars are capped.
function scale(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const top = sorted[Math.floor((sorted.length - 1) * 0.99)] ?? 0
  return top ? values.map((value) => Math.round(Math.min(1, value / top) * 255)) : values.map(() => 0)
}

// Measures the episode's audio and saves its waveform.
export async function saveWaveform(episodeId: string) {
  const waveform = await computeWaveform(episodeAudioPath(episodeId))
  const path = episodeWaveformPath(episodeId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(waveform))
}

// The episode's waveform, or null if it hasn't been made.
export async function readWaveform(episodeId: string) {
  try {
    return JSON.parse(await readFile(episodeWaveformPath(episodeId), 'utf8')) as Waveform
  } catch {
    return null
  }
}

export async function deleteWaveform(episodeId: string) {
  await rm(episodeWaveformPath(episodeId), { force: true })
}

// Makes waveforms for ready episodes that don't have one, e.g. those processed
// before waveforms existed. Runs once, in the background, after the server starts.
let backfilled = false
export async function backfillWaveforms() {
  if (backfilled) return
  backfilled = true
  const ready = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.status, 'ready'))
  for (const { id } of ready) {
    if (await stat(episodeWaveformPath(id)).catch(() => null)) continue
    await saveWaveform(id).catch((error: unknown) => console.error(`Could not make a waveform for episode ${id}:`, error))
  }
}
