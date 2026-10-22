// Stands in for the remote fetcher (podnoms-fetcher) in tests. It answers as
// the real one does, running the fake yt-dlp (fake-yt-dlp.mjs) for each job,
// so a link behaves the same whether it's fetched here or there. Besides:
//   /hang-up    the fetcher drops the connection part-way through a download
import { spawn } from 'node:child_process'
import { createReadStream, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

const rateLimited = /HTTP Error 429|not a bot/i

export async function startFakeFetcher(secret: string) {
  const dir = mkdtempSync(join(process.env.MEDIA_DIR!, 'fetcher-'))
  const files = new Map<string, string>()
  const deleted: string[] = []
  let next = 0

  // Streams yt-dlp's lines, and returns how it ended.
  const run = (args: string[], res: ServerResponse) =>
    new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
      const child = spawn(process.env.YTDLP_PATH!, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let errors = ''
      child.stdout.setEncoding('utf8')
      let buffered = ''
      child.stdout.on('data', (chunk: string) => {
        buffered += chunk
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) res.write(`${JSON.stringify({ line })}\n`)
      })
      child.stderr.on('data', (chunk) => (errors += chunk))
      child.on('close', (code) => {
        if (code === 0) resolve({ ok: true })
        else resolve({ ok: false, error: errors.trim().replace(/^ERROR:\s*(\[[^\]]+\]\s*[^:\s]+:\s*)?/, '') })
      })
    })

  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${secret}`) {
      res.writeHead(401).end()
      return
    }
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', async () => {
      const [, route, id] = req.url!.split('/')
      if (req.method === 'GET' && route === 'health') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ytDlpVersion: 'fake', publicIp: '10.0.0.9' }))
        return
      }
      if (route === 'files' && id && files.has(id)) {
        if (req.method === 'DELETE') {
          await rm(files.get(id)!, { force: true })
          files.delete(id)
          deleted.push(id)
          res.writeHead(204).end()
        } else {
          res.writeHead(200)
          createReadStream(files.get(id)!).pipe(res)
        }
        return
      }
      if (req.method !== 'POST' || (route !== 'list' && route !== 'download')) {
        res.writeHead(404).end()
        return
      }
      const { url, limit } = JSON.parse(body) as { url: string; limit?: number | null }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      if (route === 'list') {
        const result = await run(['--flat-playlist', ...(limit ? ['--playlist-end', String(limit)] : []), url], res)
        res.end(`${JSON.stringify(result.ok ? { end: true } : { error: result.error, rateLimited: rateLimited.test(result.error) })}\n`)
        return
      }
      const job = String(next++)
      const result = await run(['--output', join(dir, `${job}.%(ext)s`), url], res)
      if (new URL(url).pathname === '/hang-up') {
        res.destroy()
        return
      }
      if (!result.ok) {
        res.end(`${JSON.stringify({ error: result.error, rateLimited: rateLimited.test(result.error) })}\n`)
        return
      }
      files.set(job, join(dir, `${job}.mp3`))
      res.end(`${JSON.stringify({ file: { id: job, ext: 'mp3' } })}\n`)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    files,
    deleted,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
