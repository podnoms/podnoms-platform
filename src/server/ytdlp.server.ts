// What every call to yt-dlp shares: arguments that keep it polite to the
// platforms, and making sense of its errors. Calls should be made inside a
// download slot (see download-throttle.server.ts).
import '@tanstack/react-start/server-only'
import { spawn } from 'node:child_process'
import { env } from '~/env'
import { RateLimitedError } from '~/server/download-throttle.server'
import { getSiteSettings } from '~/server/site-settings.server'

export async function politeArgs() {
  const { downloadRateLimit } = await getSiteSettings()
  return [
    // One extraction makes several requests; pause between them.
    '--sleep-requests',
    '1',
    // Fewer retries than the default 10, each waiting longer than the last.
    '--retries',
    '3',
    '--retry-sleep',
    'exp=1:60',
    ...(downloadRateLimit ? ['--limit-rate', downloadRateLimit] : []),
  ]
}

// The platform refusing us, rather than something wrong with the one video.
const rateLimited = [/HTTP Error 429/i, /Too Many Requests/i, /confirm you.?re not a bot/i, /rate[- ]?limit/i]

// "ERROR: [youtube] abc123: This video is unavailable" → "This video is unavailable"
export function errorMessage(line: string) {
  return line.replace(/^ERROR:\s*(\[[^\]]+\]\s*[^:\s]+:\s*)?/, '')
}

export function ytDlpError(message: string) {
  return rateLimited.some((pattern) => pattern.test(message)) ? new RateLimitedError(message) : new Error(message)
}

// Runs yt-dlp, handing each line of output (on either stream) to onLine, and
// throws its last error if it fails.
export async function runYtDlpLines(args: string[], onLine: (line: string) => void) {
  const fullArgs = [...(await politeArgs()), ...args]
  return new Promise<void>((resolve, reject) => {
    const child = spawn(env.YTDLP_PATH, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    const errors: string[] = []
    const readLines = (stream: NodeJS.ReadableStream) => {
      let buffered = ''
      stream.on('data', (chunk) => {
        buffered += chunk
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('ERROR')) errors.push(errorMessage(line))
          else onLine(line)
        }
      })
      stream.on('end', () => {
        if (buffered) onLine(buffered)
      })
    }
    readLines(child.stdout)
    readLines(child.stderr)
    child.on('error', (error) => reject(new Error(`Could not run yt-dlp: ${error.message}`)))
    child.on('close', (code) => {
      if (code !== 0) reject(ytDlpError(errors.at(-1) || `yt-dlp exited with code ${code}`))
      else resolve()
    })
  })
}
