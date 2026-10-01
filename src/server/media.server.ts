// Reads and converts audio files with ffprobe and ffmpeg.
import '@tanstack/react-start/server-only'
import { spawn } from 'node:child_process'
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

// Writes the file's first audio track to an MP3, reporting progress as a
// fraction when the duration is known. MP3 audio is copied rather than
// re-encoded, so it doesn't lose quality.
export async function convertToMp3(
  source: string,
  destination: string,
  info: AudioInfo,
  onProgress: (fraction: number) => void,
) {
  const codecArgs = info.codec === 'mp3' ? ['-c:a', 'copy'] : ['-c:a', 'libmp3lame', '-q:a', '5']
  let buffered = ''
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
    (chunk) => {
      // -progress writes key=value lines; out_time_us is how far it has got.
      buffered += chunk
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        const match = /^out_time_us=(\d+)$/.exec(line)
        if (match && info.durationSeconds) {
          onProgress(Math.min(1, Number(match[1]) / 1e6 / info.durationSeconds))
        }
      }
    },
  )
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
