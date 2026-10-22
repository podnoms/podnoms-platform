// The remote fetcher (the podnoms-fetcher project): yt-dlp on another host,
// behind a VPN whose IP it changes when a platform refuses it. When
// FETCHER_URL is set, every yt-dlp run goes there instead of running here.
// It runs the same yt-dlp arguments and prints the same lines, so callers
// parse its output as they would a local run's.
//
// Its answers are newline-delimited JSON: a { line } per line of yt-dlp's
// output, then { end }, { file } (a download, collected from /files/:id) or
// { error, rateLimited }. Calls should be made inside a download slot (see
// download-throttle.server.ts), as for local runs.
import '@tanstack/react-start/server-only'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { env } from '~/env'
import { FetcherUnavailableError, RateLimitedError } from '~/server/download-throttle.server'
import { logger } from '~/server/logger.server'
import { getSiteSettings } from '~/server/site-settings.server'
import { ytDlpError } from '~/server/ytdlp.server'

// Overridable in tests.
export const fetcherConfig = {
  url: env.FETCHER_URL?.replace(/\/$/, '') ?? null,
  secret: env.FETCHER_SECRET ?? null,
}
if (fetcherConfig.url && !fetcherConfig.secret) throw new Error('FETCHER_URL is set, but FETCHER_SECRET is not')

export function usingFetcher() {
  return Boolean(fetcherConfig.url)
}

type Final = { end: true } | { file: { id: string; ext: string } } | { error: string; rateLimited: boolean }

async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs, ...rest } = init
  let response: Response
  try {
    response = await fetch(`${fetcherConfig.url}${path}`, {
      ...rest,
      headers: { Authorization: `Bearer ${fetcherConfig.secret}`, ...rest.headers },
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    })
  } catch (error) {
    throw new FetcherUnavailableError(`Couldn't reach the download server: ${error instanceof Error ? error.message : String(error)}`)
  }
  // A link it won't take is this download's problem; anything else is the
  // fetcher's (or its configuration's), so try again later.
  if (response.status === 400) throw new Error(`The download server turned the request down: ${await response.text()}`)
  if (!response.ok) throw new FetcherUnavailableError(`The download server answered ${response.status} ${response.statusText}`.trim())
  return response
}

// Runs a job, handing each line of yt-dlp's output to onLine, and returns how
// it ended; throws its error if it failed.
async function runJob(path: string, body: unknown, onLine: (line: string) => void) {
  const response = await request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let final: Final | undefined
  let buffered = ''
  const handle = (text: string) => {
    if (!text) return
    const message = JSON.parse(text) as { line: string } | Final
    if ('line' in message) onLine(message.line)
    else final = message
  }
  try {
    const decoder = new TextDecoder()
    for await (const chunk of response.body!) {
      buffered += decoder.decode(chunk, { stream: true })
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      lines.forEach(handle)
    }
    handle(buffered)
  } catch (error) {
    throw new FetcherUnavailableError(`Lost the download server: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!final) throw new FetcherUnavailableError('The download server stopped before saying how it went')
  if ('error' in final) throw final.rateLimited ? new RateLimitedError(final.error) : ytDlpError(final.error)
  return final
}

// As listing with yt-dlp here.
export async function remoteList(url: string, limit: number | null, onLine: (line: string) => void) {
  await runJob('/list', { url, limit }, onLine)
}

// Downloads the source's audio on the fetcher, then copies it here, to
// `outputTemplate` with yt-dlp's `%(ext)s` filled in. Returns its path.
export async function remoteDownload(url: string, outputTemplate: string, onLine: (line: string) => void) {
  const { downloadRateLimit } = await getSiteSettings()
  const final = await runJob('/download', { url, ...(downloadRateLimit ? { limitRate: downloadRateLimit } : {}) }, onLine)
  if (!('file' in final)) throw new Error("The download server didn't send the download")
  const { id, ext } = final.file
  const path = outputTemplate.replace('%(ext)s', ext)
  try {
    const response = await request(`/files/${id}`)
    await pipeline(Readable.fromWeb(response.body! as NodeReadableStream), createWriteStream(path))
  } catch (error) {
    await rm(path, { force: true })
    throw error instanceof RateLimitedError ? error : new FetcherUnavailableError(`Couldn't collect the download: ${String(error)}`)
  } finally {
    // It's swept up there in time anyway.
    await request(`/files/${id}`, { method: 'DELETE', timeoutMs: 15_000 }).catch((error: unknown) =>
      logger.warn({ err: error, id }, "Couldn't delete a download from the download server"),
    )
  }
  return path
}

export type FetcherHealth =
  | { reachable: true; ytDlpVersion: string | null; publicIp: string | null }
  | { reachable: false; error: string }

// For the admin page; null without a fetcher.
export async function fetcherHealth(): Promise<FetcherHealth | null> {
  if (!usingFetcher()) return null
  try {
    const response = await request('/health', { timeoutMs: 5000 })
    const health = (await response.json()) as { ytDlpVersion?: string | null; publicIp?: string | null }
    return { reachable: true, ytDlpVersion: health.ytDlpVersion ?? null, publicIp: health.publicIp ?? null }
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) }
  }
}
