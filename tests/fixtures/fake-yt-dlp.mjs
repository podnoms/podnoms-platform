#!/usr/bin/env node
// Stands in for yt-dlp in tests (YTDLP_PATH, see test/setup.ts). It answers
// like the real one does to the arguments episode-processor.server.ts passes,
// and behaves according to the link:
//   ?title=…&description=…&duration=…&thumbnail=…  what it reports about the source
//   /fail                                          fails as an unavailable video
//   /no-info                                       exits without reporting anything
//   ?hold=ms                                       pauses after reporting download progress
//   ?upload_date=YYYYMMDD                          reports when it was uploaded
//   /rate-limited                                  fails as the platform refusing us (HTTP 429)
// Given --flat-playlist, it lists a channel instead:
//   ?entries=c,b,a&title=…&thumbnail=…              its uploads' ids, newest first, and details
//   &live=b&short=a                                 uploads that are live streams or Shorts
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
if (url.pathname === '/rate-limited') {
  console.error('ERROR: [youtube] abc123: Unable to download webpage: HTTP Error 429: Too Many Requests')
  process.exit(1)
}
if (url.pathname === '/no-info') process.exit(0)

if (args.includes('--flat-playlist')) {
  const list = (name) => url.searchParams.get(name)?.split(',').filter(Boolean) ?? []
  const end = args.includes('--playlist-end') ? Number(args[args.indexOf('--playlist-end') + 1]) : Infinity
  for (const [index, id] of list('entries').slice(0, end).entries()) {
    const entry = {
      id,
      url: `https://video.test/watch?${new URLSearchParams({ title: `Video ${id}`, upload_date: `202601${String(28 - index).padStart(2, '0')}` })}`,
      title: `Video ${id}`,
      duration: list('short').includes(id) ? 30 : 600,
      live_status: list('live').includes(id) ? 'is_live' : 'not_live',
    }
    console.log(`ENTRY ${JSON.stringify(entry)}`)
  }
  const thumbnail = url.searchParams.get('thumbnail')
  console.log(`PLAYLIST ${JSON.stringify({
    title: `${url.searchParams.get('title') ?? 'Test Channel'} - Videos`,
    description: url.searchParams.get('description') ?? undefined,
    thumbnails: thumbnail ? [{ url: thumbnail, id: 'avatar_uncropped' }] : [],
  })}`)
  process.exit(0)
}

const param = (name) => url.searchParams.get(name) ?? undefined
const duration = param('duration')
const details = {
  title: param('title'),
  description: param('description'),
  duration: duration ? Number(duration) : undefined,
  thumbnail: param('thumbnail'),
}
// Looked up before the download starts.
console.log(`DETAILS ${JSON.stringify(details)}`)

const hold = () => new Promise((resolve) => setTimeout(resolve, Number(url.searchParams.get('hold') ?? 0)))
const total = 3000
for (const downloaded of [1000, 2000, total]) {
  const progress = { status: 'downloading', downloaded_bytes: downloaded, total_bytes: total, total_bytes_estimate: null, speed: 1000, eta: (total - downloaded) / 1000 }
  console.log(`PROGRESS ${JSON.stringify(progress)}`)
}
await hold()

const filepath = output.replace('%(ext)s', 'mp3')
copyFileSync(process.env.FAKE_YTDLP_AUDIO, filepath)
console.log(`INFO ${JSON.stringify({ ...details, upload_date: param('upload_date'), filepath })}`)
