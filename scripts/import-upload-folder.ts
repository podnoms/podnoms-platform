// Adds a folder of audio files to a show as uploaded episodes, as the bulk
// upload form would for its owner, without going through the browser: for
// shows belonging to someone else, or folders too big to upload.
//
//   bun scripts/import-upload-folder.ts <dir> --show <show id> --staging <dir> [--apply]
//
// Without --apply it probes each file and links it into <staging>/sources/
// under its episode id (symlinks: copy them with `rsync -L` into the real
// MEDIA_DIR/sources/ before applying). With --apply it adds the episode rows,
// pending, for the app to convert when it next resumes unfinished episodes
// (restart it, then open a show page). --skip <file name> leaves one out. Each file's title is its name; a date
// in the name (DD-MM-YYYY or DD-MM-YY) is its publish date. Ids are made from
// the show and file name, so running it again leaves what's there alone.
import { mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { episodes, shows } from '~/server/db/schema'
import { availableEpisodeSlug } from '~/server/episode-slugs.server'
import { probeAudio } from '~/server/media.server'
import { titleFromFilename } from '~/server/uploads.server'
import { uuidV5 } from '~/server/uuid.server'

const namespace = '9d0e7c41-2b6a-5f3e-a8c4-1e7b3d5f9a20'

function arg(name: string) {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const dir = resolve(process.argv[2] ?? '')
const showId = arg('--show')
const staging = arg('--staging')
const apply = process.argv.includes('--apply')
// --skip <file name>, as many times as needed: files to leave out.
const skip = new Set(process.argv.flatMap((a, i) => (a === '--skip' ? [process.argv[i + 1]] : [])))
if (!process.argv[2] || !showId || !staging) {
  console.error('Usage: bun scripts/import-upload-folder.ts <dir> --show <show id> --staging <dir> [--apply]')
  process.exit(1)
}

function dateFrom(name: string) {
  const match = name.match(/\b(\d{2})(?: \(\d+\))?-(\d{2})-(\d{4}|\d{2})\b/)
  if (!match) return null
  const [, d, m, y] = match
  const year = y!.length === 2 ? 2000 + Number(y) : Number(y)
  const date = new Date(Date.UTC(year, Number(m) - 1, Number(d), 12))
  return date.getUTCMonth() === Number(m) - 1 ? date : null
}

const [show] = await db.select({ id: shows.id, title: shows.title }).from(shows).where(eq(shows.id, showId)).limit(1)
if (!show) throw new Error(`No show ${showId}`)
console.log(`Show: ${show.title}`)

const files = (await readdir(dir)).filter((f) => /\.(mp3|wav|m4a|flac|ogg|aac)$/i.test(f) && !skip.has(f)).sort()
const ids = files.map((f) => uuidV5(`${showId}:${f}`, namespace))
const existing = new Set(
  (await db.select({ id: episodes.id }).from(episodes).where(inArray(episodes.id, ids))).map((e) => e.id),
)
await mkdir(join(staging, 'sources'), { recursive: true })

const now = Date.now()
let added = 0
for (const [i, file] of files.entries()) {
  const id = ids[i]!
  if (existing.has(id)) continue
  const path = join(dir, file)
  const info = await probeAudio(path)
  if (!info) {
    console.warn(`SKIP (no audio): ${file}`)
    continue
  }
  const title = titleFromFilename(file).replace(/\s+/g, ' ')
  const publishedAt = dateFrom(file) ?? new Date(now + i * 1000)
  const link = join(staging, 'sources', id)
  await rm(link, { force: true })
  await symlink(path, link)
  console.log(`${apply ? 'ADD ' : 'PLAN'} ${id} ${publishedAt.toISOString().slice(0, 10)} ${Math.round((info.durationSeconds ?? 0) / 60)}m  ${title}`)
  if (apply) {
    await db.insert(episodes).values({
      id,
      showId,
      title,
      slug: await availableEpisodeSlug(showId, title),
      durationSeconds: info.durationSeconds,
      publishedAt,
      status: 'pending',
    })
  }
  added++
}
console.log(`${apply ? 'Added' : 'Would add'} ${added}; ${existing.size} already there`)
process.exit(0)
