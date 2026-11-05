// Reads and converts audio files with ffprobe and ffmpeg.
import '@tanstack/react-start/server-only'
import { spawn } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { env } from '~/env'

export type AudioInfo = {
  codec: string
  durationSeconds: number | null
  // From the file's tags, e.g. an MP3's ID3 title.
  title: string | null
}

type ProbeOutput = {
  streams?: { codec_name?: string }[]
  format?: { duration?: string; tags?: Record<string, string> }
}

function run(command: string, args: string[], onStdout?: (chunk: string) => void) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (onStdout) onStdout(chunk)
      else stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      // Only the tail is useful, and long conversions can log a lot.
      stderr = (stderr + chunk).slice(-4000)
    })
    child.on('error', (error) => reject(new Error(`Could not run ${command}: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim().split('\n').at(-1) || `${command} exited with code ${code}`))
    })
  })
}

// Null when the file has no audio (or isn't a media file at all).
export async function probeAudio(path: string): Promise<AudioInfo | null> {
  let output: ProbeOutput
  try {
    const json = await run(env.FFPROBE_PATH, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-select_streams', 'a:0',
      path,
    ])
    output = JSON.parse(json) as ProbeOutput
  } catch {
    return null
  }
  const codec = output.streams?.[0]?.codec_name
  if (!codec) return null
  const duration = Number(output.format?.duration)
  const tags = output.format?.tags ?? {}
  const title = (tags.title ?? tags.TITLE)?.trim()
  return {
    codec,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    title: title || null,
  }
}

// Everything we encode is MP3 at this constant bitrate, the highest MP3 has.
export const mp3Bitrate = '320k'

// Reads ffmpeg's -progress output (key=value lines; out_time_us is how far
// it has got), reporting it as a fraction when the duration is known.
function progressReader(durationSeconds: number | null, onProgress: (fraction: number) => void) {
  let buffered = ''
  return (chunk: string) => {
    buffered += chunk
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      const match = /^out_time_us=(\d+)$/.exec(line)
      if (match && durationSeconds) onProgress(Math.min(1, Number(match[1]) / 1e6 / durationSeconds))
    }
  }
}

// Writes the file's first audio track to an MP3, reporting progress as a
// fraction when the duration is known. MP3 audio is copied rather than
// re-encoded, so it doesn't lose quality (re-encoding a lower-bitrate MP3 at
// 320k would only make it bigger). Anything else is encoded at mp3Bitrate.
export async function convertToMp3(
  source: string,
  destination: string,
  info: AudioInfo,
  onProgress: (fraction: number) => void,
) {
  const codecArgs = info.codec === 'mp3' ? ['-c:a', 'copy'] : ['-c:a', 'libmp3lame', '-b:a', mp3Bitrate]
  await run(
    env.FFMPEG_PATH,
    [
      '-hide_banner', '-nostdin', '-y',
      '-i', source,
      '-map', '0:a:0',
      ...codecArgs,
      '-progress', 'pipe:1', '-nostats',
      '-f', 'mp3',
      destination,
    ],
    progressReader(info.durationSeconds, onProgress),
  )
}

// Copies the file's first audio track, untouched, into Matroska (which takes
// any codec): the episode's master, which its MP3 and HLS stream are made
// from. Video is left behind.
export async function extractMaster(source: string, destination: string) {
  await run(env.FFMPEG_PATH, [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-i', source,
    '-map', '0:a:0', '-vn',
    '-c:a', 'copy',
    '-f', 'matroska',
    destination,
  ])
}

// What choosing a stream's bitrates needs to know about its source.
export type StreamInfo = {
  codec: string
  // Bits per second: the audio track's, or failing that the whole file's.
  bitrate: number | null
  channels: number
  durationSeconds: number | null
}

type StreamProbeOutput = {
  streams?: { codec_name?: string; bit_rate?: string; channels?: number }[]
  format?: { duration?: string; bit_rate?: string }
}

export async function probeStream(path: string): Promise<StreamInfo | null> {
  let output: StreamProbeOutput
  try {
    const json = await run(env.FFPROBE_PATH, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_entries', 'stream=codec_name,bit_rate,channels:format=duration,bit_rate',
      '-select_streams', 'a:0',
      path,
    ])
    output = JSON.parse(json) as StreamProbeOutput
  } catch {
    return null
  }
  const stream = output.streams?.[0]
  if (!stream?.codec_name) return null
  const bitrate = Number(stream.bit_rate) || Number(output.format?.bit_rate) || null
  const duration = Number(output.format?.duration)
  return {
    codec: stream.codec_name,
    bitrate,
    channels: stream.channels ?? 2,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
  }
}

// The HLS stream's bitrates (AAC), lowest first, as players start with the
// first. Mono sources get mono at half the rate.
const stereoLadder = [96_000, 160_000, 256_000]
// Bitrates up to this much above the source's are still made: AAC needs less
// than most codecs for the same quality, so 160k is worth having from a 128k
// MP3, but 256k isn't.
const headroom = 1.25

// Lossless sources' bitrates say how well they compressed, not how good they
// are (a quiet FLAC can be tiny), so they always get every bitrate.
const lossless = /^(flac|alac|wavpack|tta|ape|truehd|mlp|pcm_.*)$/

export function hlsRenditions({ codec, bitrate, channels }: Pick<StreamInfo, 'codec' | 'bitrate' | 'channels'>) {
  const mono = channels === 1
  const ladder = mono ? stereoLadder.map((rate) => rate / 2) : stereoLadder
  // Never more than the source has; the lowest is always made.
  const kept = bitrate && !lossless.test(codec) ? ladder.filter((rate, i) => i === 0 || rate <= bitrate * headroom) : ladder
  return kept.map((rate) => ({ name: `${rate / 1000}k`, bitrate: rate, channels: mono ? 1 : 2 }))
}

// Segments are about this long.
export const hlsSegmentSeconds = 6

// Writes an HLS stream of the master into `dir`: master.m3u8, and for each
// bitrate a folder (named like "160k") with its playlist, init segment and
// segments, which the playlists name relatively. VOD, in fMP4 segments.
export async function packageHls(
  master: string,
  dir: string,
  info: StreamInfo,
  onProgress: (fraction: number) => void,
) {
  const renditions = hlsRenditions(info)
  await run(
    env.FFMPEG_PATH,
    [
      '-hide_banner', '-nostdin', '-y',
      '-i', master,
      ...renditions.flatMap(() => ['-map', '0:a:0']),
      '-c:a', 'aac',
      ...renditions.flatMap((rendition, i) => [`-b:a:${i}`, String(rendition.bitrate), `-ac:a:${i}`, String(rendition.channels)]),
      '-progress', 'pipe:1', '-nostats',
      '-f', 'hls',
      '-hls_time', String(hlsSegmentSeconds),
      '-hls_playlist_type', 'vod',
      '-hls_segment_type', 'fmp4',
      '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_segment_filename', `${dir}/%v/seg-%05d.m4s`,
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', renditions.map((rendition, i) => `a:${i},name:${rendition.name}`).join(' '),
      `${dir}/%v/index.m3u8`,
    ],
    progressReader(info.durationSeconds, onProgress),
  )
  return renditions
}

// Joins recordings (a live broadcast's segments, in order) into one file of
// just their audio, copied rather than re-encoded. It's Matroska, which takes
// any codec; convertToMp3 makes the episode's MP3 from it.
export async function joinAudio(sources: string[], destination: string) {
  // The concat demuxer reads its inputs from a list, quoted as it expects.
  const list = sources.map((source) => `file '${source.replaceAll("'", "'\\''")}'`).join('\n')
  const listPath = `${destination}.list`
  await writeFile(listPath, `${list}\n`)
  try {
    await run(env.FFMPEG_PATH, [
      '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0',
      '-i', listPath,
      '-map', '0:a:0', '-vn',
      '-c:a', 'copy',
      '-f', 'matroska',
      destination,
    ])
  } finally {
    await rm(listPath, { force: true })
  }
}

// Decodes the first frame of anything ffmpeg can read as an image to a PNG,
// for formats the image library can't read itself (e.g. some HEIC photos).
export async function decodeImageToPng(source: string, destination: string) {
  await run(env.FFMPEG_PATH, [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-i', source,
    '-frames:v', '1',
    '-f', 'image2', '-c:v', 'png',
    destination,
  ])
}
