#!/usr/bin/env node
// Stands in for yt-dlp in tests (YTDLP_PATH, see test/setup.ts). It answers
// like the real one does to the arguments episode-processor.server.ts passes,
// and behaves according to the link:
//   ?title=…&description=…&duration=…&thumbnail=…  what it reports about the source
//   /fail                                          fails as an unavailable video
//   /no-info                                       exits without reporting anything
//   ?hold=ms                                       pauses after reporting download progress
// The audio it "downloads" is a copy of FAKE_YTDLP_AUDIO.
import { copyFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const output = args[args.indexOf('--output') + 1]
const url = new URL(args.at(-1))
writeFileSync(`${process.env.MEDIA_DIR}/yt-dlp-args.json`, JSON.stringify(args))

if (url.pathname === '/fail') {
  console.error('ERROR: [youtube] abc123: This video is unavailable')
  process.exit(1)
}
if (url.pathname === '/no-info') process.exit(0)

const hold = () => new Promise((resolve) => setTimeout(resolve, Number(url.searchParams.get('hold') ?? 0)))
const total = 3000
for (const downloaded of [1000, 2000, total]) {
  const progress = { status: 'downloading', downloaded_bytes: downloaded, total_bytes: total, total_bytes_estimate: null, speed: 1000, eta: (total - downloaded) / 1000 }
  console.log(`PROGRESS ${JSON.stringify(progress)}`)
}
await hold()

const filepath = output.replace('%(ext)s', 'mp3')
copyFileSync(process.env.FAKE_YTDLP_AUDIO, filepath)
const param = (name) => url.searchParams.get(name) ?? undefined
const duration = param('duration')
console.log(`INFO ${JSON.stringify({
  title: param('title'),
  description: param('description'),
  duration: duration ? Number(duration) : undefined,
  thumbnail: param('thumbnail'),
  filepath,
})}`)
