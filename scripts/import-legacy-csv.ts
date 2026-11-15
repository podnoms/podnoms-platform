// Imports one owner's shows and episodes from a CSV exported from the old
// PodNoms (one row per episode, with the show's columns repeated; a show with
// no episodes has one row with empty episode columns): PodcastId is the show,
// EntryId the episode. The owner must already have an account here.
//
//   bun scripts/import-legacy-csv.ts <csv> --owner <email> [options]
//
//   --audio <dir>        the old audio files, <EntryId>.mp3 (in any case)
//   --images <dir>       the old images: <dir>/podcast/<PodcastId>.jpg and
//                        <dir>/entry/<EntryId>.jpg
//   --stage              write the media files into MEDIA_DIR, but change
//                        nothing in the database
//   --apply              write the media files and the database rows
//   --owner-name <name>  give the owner this name if they have none
//   --user-alias <slug>  the owner's old slug, so their old addresses redirect
//   --report <file>      write what was done (with old → new ids) as JSON
//
// Without --stage or --apply it only reports what it would do. Running it
// again is safe: ids are made from the old ones, so rows and files already
// there are left alone.
//
// Each episode becomes one of:
//   - ready, when its audio is in --audio: the MP3 is copied as the episode's
//     audio (it has no master, as with episodes made before masters were
//     kept), with its waveform; the app builds its HLS stream when a show page
//     is next loaded;
//   - pending, when there's no audio but a source link: the app downloads it
//     when it next resumes unfinished episodes (restart it, then open a show
//     page), keeping the title and date from here;
//   - failed, with a note, when there's neither, so the owner can see it on
//     the manage page and replace its audio.
//
// MEDIA_DIR may be a staging folder to copy into the real one afterwards: the
// database rows refer to the files by episode id, not by where they are. Set
// SITE_URL to the site's address so the feeds' podcast:guid is made from
// their real URL, as it would be for a show made on the site.
import { copyFile, mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { env } from '~/env'
import { reservedEpisodeSlugs, reservedShowSlugs } from '~/lib/paths'
import { firstFreeSlug, slugify } from '~/lib/slug'
import { userSlugSchema } from '~/lib/user-slug'
import { db } from '~/server/db/client.server'
import {
  episodes,
  shows,
  showSlugAliases,
  users,
  userSlugAliases,
  type NewEpisode,
  type NewShow,
} from '~/server/db/schema'
import { convertToArtwork } from '~/server/images.server'
import { convertToMp3, probeAudio, type AudioInfo } from '~/server/media.server'
import { newPodcastGuid } from '~/server/podcast-guid.server'
import {
  ensureAudioDir,
  ensureImagesDir,
  episodeAudioPath,
  episodeAudioUrl,
  episodeWaveformPath,
  imagePath,
  imageUrl,
} from '~/server/storage.server'
import { titleFromFilename } from '~/server/uploads.server'
import { uuidV5 } from '~/server/uuid.server'
import { computeWaveform } from '~/server/waveforms.server'

// New ids are UUIDv5s of the old ids in this namespace, so running the import
// again finds what it made before. Never change it.
const importNamespace = '4b5a1d2e-9c3f-5e7a-8b6d-2f1e0c9a7b53'
const showId = (podcastId: string) => uuidV5(`show:${podcastId.toLowerCase()}`, importNamespace)
const episodeId = (entryId: string) => uuidV5(`episode:${entryId.toLowerCase()}`, importNamespace)
const imageId = (kind: 'show' | 'episode', oldId: string) => uuidV5(`image:${kind}:${oldId.toLowerCase()}`, importNamespace)

const placeholderError =
  'Imported from the old site without its audio: it was not in the backup and had no source link. Replace the audio to restore it.'

// --- The CSV ---------------------------------------------------------------

// RFC 4180: fields may be quoted, and quoted fields may hold commas, line
// breaks and doubled quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char !== '"') field += char
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

type CsvRow = Record<string, string>

function readRows(text: string): CsvRow[] {
  const [header, ...lines] = parseCsv(text.replace(/^﻿/, ''))
  if (!header) throw new Error('The CSV is empty')
  return lines
    .filter((line) => line.some((field) => field.trim()))
    .map((line) => Object.fromEntries(header.map((name, i) => [name.trim(), (line[i] ?? '').trim()])))
}

// "12/16/2018 15:00" (US order, no zone: taken as UTC) or an ISO-ish
// "2018-12-05 15:29:00.0000000"; null for the old site's "0001-01-01" blank.
function parseDate(value: string): Date | null {
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})$/)
  if (us) {
    const [, month, day, year, hour, minute] = us.map(Number) as number[]
    return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!))
  }
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (iso) {
    const [, year, month, day, hour, minute, second] = iso.map(Number) as number[]
    if (year! < 1900) return null
    return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second || 0))
  }
  return null
}

// The old titles as they were, bar two tidy-ups: a file name loses its
// extension, and a title with underscores for spaces gets its spaces back.
function tidyTitle(title: string) {
  let tidy = /\.[a-z0-9]{2,4}$/i.test(title) ? titleFromFilename(title) : title
  if (!tidy.includes(' ') && tidy.includes('_')) tidy = tidy.replace(/_+/g, ' ').trim()
  return tidy || 'Untitled episode'
}

// --- What to import ----------------------------------------------------------

type Options = {
  csv: string
  owner: string
  audioDir: string | null
  imagesDir: string | null
  stage: boolean
  apply: boolean
  ownerName: string | null
  userAlias: string | null
  report: string | null
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    csv: '',
    owner: '',
    audioDir: null,
    imagesDir: null,
    stage: false,
    apply: false,
    ownerName: null,
    userAlias: null,
    report: null,
  }
  const value = (i: number) => {
    const next = args[i + 1]
    if (next === undefined || next.startsWith('--')) throw new Error(`${args[i]} needs a value`)
    return next
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--owner') options.owner = value(i++)
    else if (arg === '--audio') options.audioDir = resolve(value(i++))
    else if (arg === '--images') options.imagesDir = resolve(value(i++))
    else if (arg === '--owner-name') options.ownerName = value(i++)
    else if (arg === '--user-alias') options.userAlias = value(i++)
    else if (arg === '--report') options.report = resolve(value(i++))
    else if (arg === '--stage') options.stage = true
    else if (arg === '--apply') options.apply = true
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`)
    else if (!options.csv) options.csv = resolve(arg)
    else throw new Error(`Unexpected argument ${arg}`)
  }
  if (!options.csv) throw new Error('Give the CSV file')
  if (!options.owner) throw new Error('Give the owner with --owner <email>')
  return options
}

type EpisodeKind = 'audio' | 'link' | 'placeholder'

type PlannedEpisode = {
  entryId: string
  id: string
  kind: EpisodeKind
  title: string
  sourceUrl: string | null
  createdAt: Date | null
  // The old audio file, when it's there and readable (or a readable copy of it).
  audioSource: string | null
  audio: AudioInfo | null
  // The old artwork, when it's there.
  imageSource: string | null
  durationSeconds: number | null
}

type PlannedShow = {
  podcastId: string
  id: string
  title: string
  slug: string
  createdAt: Date | null
  imageSource: string | null
  episodes: PlannedEpisode[]
}

// The old site stored whatever it was given as .mp3, and some files are
// another format with an ID3v2 tag in front (an M4A, say), which ffmpeg can't
// read as they are. Returns the file (or a copy without the tag) and what
// ffprobe makes of it, or null if it isn't audio either way.
async function readableAudio(path: string): Promise<{ path: string; audio: AudioInfo } | null> {
  const audio = await probeAudio(path)
  if (audio) return { path, audio }
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(10)
    const { bytesRead } = await file.read(header, 0, 10, 0)
    if (bytesRead < 10 || header.toString('latin1', 0, 3) !== 'ID3') return null
    const size = ((header[6]! & 0x7f) << 21) | ((header[7]! & 0x7f) << 14) | ((header[8]! & 0x7f) << 7) | (header[9]! & 0x7f)
    const footer = header[5]! & 0x10 ? 10 : 0
    const stripped = join(tmpdir(), 'podnoms-import', `${basename(path)}.stripped`)
    await mkdir(dirname(stripped), { recursive: true })
    const rest = await file.readFile()
    await writeFile(stripped, rest.subarray(10 + size + footer))
    const strippedAudio = await probeAudio(stripped)
    return strippedAudio ? { path: stripped, audio: strippedAudio } : null
  } finally {
    await file.close()
  }
}

// The files in a folder by their lower-cased names, as the old ids come in
// either case.
async function filesByLowerName(dir: string | null) {
  if (!dir) return new Map<string, string>()
  const names = await readdir(dir).catch((error: unknown) => {
    throw new Error(`Can't read ${dir}: ${error instanceof Error ? error.message : String(error)}`)
  })
  return new Map(names.map((name) => [name.toLowerCase(), join(dir, name)]))
}

async function plan(options: Options) {
  const rows = readRows(await readFile(options.csv, 'utf8'))
  const audioFiles = await filesByLowerName(options.audioDir)
  const showImages = await filesByLowerName(options.imagesDir && join(options.imagesDir, 'podcast'))
  const episodeImages = await filesByLowerName(options.imagesDir && join(options.imagesDir, 'entry'))

  const emails = new Set(rows.map((row) => row.UserEmail?.toLowerCase()).filter(Boolean))
  if (emails.size > 1) throw new Error(`The CSV has more than one owner: ${[...emails].join(', ')}`)
  const csvEmail = [...emails][0]
  if (csvEmail && csvEmail !== options.owner.toLowerCase()) {
    console.warn(`Note: the CSV's owner is ${csvEmail}, importing for ${options.owner}`)
  }

  const planned = new Map<string, PlannedShow>()
  for (const row of rows) {
    const podcastId = row.PodcastId
    if (!podcastId) throw new Error('A row has no PodcastId')
    let show = planned.get(podcastId)
    if (!show) {
      show = {
        podcastId,
        id: showId(podcastId),
        title: row.PodcastTitle || 'Untitled show',
        slug: row.PodcastSlug || slugify(row.PodcastTitle || '', 'show'),
        createdAt: parseDate(row.PodcastCreateDate ?? ''),
        imageSource: showImages.get(`${podcastId.toLowerCase()}.jpg`) ?? null,
        episodes: [],
      }
      planned.set(podcastId, show)
    }
    const entryId = row.EntryId
    if (!entryId) continue
    const backup = audioFiles.get(`${entryId.toLowerCase()}.mp3`) ?? null
    const sourceUrl = row.SourceUrl || null
    const readable = backup ? await readableAudio(backup) : null
    if (backup && !readable) console.warn(`${entryId}: the backup file isn't audio, ignoring it: ${backup}`)
    const audio = readable?.audio ?? null
    show.episodes.push({
      entryId,
      id: episodeId(entryId),
      kind: audio ? 'audio' : sourceUrl ? 'link' : 'placeholder',
      title: tidyTitle(row.EntryTitle ?? ''),
      sourceUrl,
      createdAt: parseDate(row.CreateDate ?? ''),
      audioSource: readable?.path ?? null,
      audio,
      imageSource: episodeImages.get(`${entryId.toLowerCase()}.jpg`) ?? null,
      durationSeconds: audio?.durationSeconds ?? null,
    })
  }
  return [...planned.values()]
}

// --- Media files -------------------------------------------------------------

async function exists(path: string) {
  return (await stat(path).catch(() => null)) !== null
}

// Copies the old MP3 in as the episode's audio (or encodes an MP3 from a file
// that's some other format) and makes its waveform, unless they're there
// already. Returns the audio's size and length.
async function stageAudio(episode: PlannedEpisode) {
  const target = episodeAudioPath(episode.id)
  const current = await stat(target).catch(() => null)
  if (episode.audio!.codec === 'mp3') {
    const source = await stat(episode.audioSource!)
    if (!current || current.size !== source.size) await copyFile(episode.audioSource!, target)
  } else if (!current) {
    console.log(`  encoding ${episode.title} (${episode.audio!.codec}) as MP3`)
    await convertToMp3(episode.audioSource!, target, episode.audio!, () => {})
  }
  const audio = await probeAudio(target)
  if (!audio) throw new Error(`${episode.entryId}: the copied audio can't be read: ${target}`)
  const waveform = episodeWaveformPath(episode.id)
  if (!(await exists(waveform))) {
    await mkdir(dirname(waveform), { recursive: true })
    await writeFile(waveform, JSON.stringify(await computeWaveform(target)))
  }
  return { sizeBytes: (await stat(target)).size, durationSeconds: audio.durationSeconds }
}

// Converts the old artwork into the image store, unless it's there already.
// Returns its URL, or null if the file can't be read as an image.
async function stageImage(source: string, id: string, what: string) {
  const target = imagePath(id)
  if (!(await exists(target))) {
    try {
      await convertToArtwork(source, target)
    } catch (error) {
      console.warn(`${what}: couldn't convert the artwork ${source}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
  return imageUrl(id)
}

// --- Database rows -----------------------------------------------------------

async function findOwner(email: string) {
  const [owner] = await db
    .select({ id: users.id, slug: users.slug, name: users.name })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  if (!owner) throw new Error(`No user with the email ${email}`)
  return owner
}

// Show slugs the owner can't have: the site's paths under a user, their
// other shows' slugs and their old ones.
async function takenShowSlugs(ownerId: string) {
  const current = await db.select({ slug: shows.slug }).from(shows).where(eq(shows.userId, ownerId))
  const old = await db.select({ slug: showSlugAliases.slug }).from(showSlugAliases).where(eq(showSlugAliases.userId, ownerId))
  return new Set([...reservedShowSlugs, ...current.map((row) => row.slug), ...old.map((row) => row.slug)])
}

async function existingShow(id: string) {
  const [show] = await db.select({ id: shows.id, slug: shows.slug }).from(shows).where(eq(shows.id, id)).limit(1)
  return show ?? null
}

async function existingEpisodeIds(ids: string[]) {
  if (ids.length === 0) return new Set<string>()
  const rows = await db.select({ id: episodes.id }).from(episodes).where(inArray(episodes.id, ids))
  return new Set(rows.map((row) => row.id))
}

async function takenEpisodeSlugs(id: string) {
  const rows = await db.select({ slug: episodes.slug }).from(episodes).where(eq(episodes.showId, id))
  return new Set([...reservedEpisodeSlugs, ...rows.map((row) => row.slug)])
}

// Records the owner's old slug so their old addresses redirect, unless
// someone has it.
async function addUserAlias(ownerId: string, alias: string) {
  const slug = userSlugSchema.parse(alias)
  const [owner] = await db.select({ slug: users.slug }).from(users).where(eq(users.id, ownerId)).limit(1)
  if (owner?.slug === slug) return 'already theirs'
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.slug, slug)).limit(1)
  if (taken) return 'taken by another user'
  const [aliased] = await db.select({ userId: userSlugAliases.userId }).from(userSlugAliases).where(eq(userSlugAliases.slug, slug)).limit(1)
  if (aliased) return aliased.userId === ownerId ? 'already recorded' : 'taken by another user'
  await db.insert(userSlugAliases).values({ slug, userId: ownerId })
  return 'added'
}

// --- Running it --------------------------------------------------------------

type Report = {
  owner: { id: string; email: string; slug: string }
  shows: {
    podcastId: string
    id: string
    slug: string
    title: string
    created: boolean
    episodes: { entryId: string; id: string; slug: string; kind: EpisodeKind; created: boolean }[]
  }[]
}

function hours(seconds: number) {
  return (seconds / 3600).toFixed(1)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const mode = options.apply ? 'apply' : options.stage ? 'stage' : 'dry run'
  console.log(`Mode: ${mode}`)
  console.log(`Database: ${new URL(env.DATABASE_URL).host}${new URL(env.DATABASE_URL).pathname}`)
  console.log(`Media: ${resolve(env.MEDIA_DIR)}`)
  console.log(`Site: ${env.SITE_URL ?? '(SITE_URL not set: feed guids will be random)'}`)

  const owner = await findOwner(options.owner)
  console.log(`Owner: ${options.owner} (${owner.id}, /${owner.slug})\n`)
  const planned = await plan(options)

  const report: Report = { owner: { id: owner.id, email: options.owner, slug: owner.slug }, shows: [] }
  const totals = { shows: 0, audio: 0, link: 0, placeholder: 0, seconds: 0, showImages: 0, episodeImages: 0 }
  const write = options.stage || options.apply
  const taken = await takenShowSlugs(owner.id)

  if (write) {
    await ensureAudioDir()
    await ensureImagesDir()
  }

  for (const show of planned) {
    const already = await existingShow(show.id)
    const slug = already?.slug ?? firstFreeSlug(show.slug, taken)
    taken.add(slug)
    const counts = { audio: 0, link: 0, placeholder: 0 }
    for (const episode of show.episodes) counts[episode.kind]++
    const where = already ? 'exists' : options.apply ? 'creating' : 'would create'
    console.log(`${show.title} → /${owner.slug}/${slug} (${where}): ${show.episodes.length} episodes: ${counts.audio} with audio, ${counts.link} from links, ${counts.placeholder} without either${show.imageSource ? ', artwork' : ''}`)
    if (slug !== show.slug) console.log(`  slug ${show.slug} was taken; using ${slug}`)
    for (const episode of show.episodes) {
      if (episode.kind === 'placeholder') console.log(`  no audio or link: ${episode.title} (${episode.entryId})`)
    }

    const showImageUrl =
      show.imageSource && write ? await stageImage(show.imageSource, imageId('show', show.podcastId), show.title) : null
    if (show.imageSource) totals.showImages++
    const episodeDates = show.episodes.map((episode) => episode.createdAt?.getTime()).filter((time): time is number => time !== undefined)
    const createdAt = show.createdAt ?? (episodeDates.length ? new Date(Math.min(...episodeDates)) : new Date())

    let created = false
    if (options.apply && !already) {
      const values: NewShow = {
        id: show.id,
        userId: owner.id,
        title: show.title,
        slug,
        podcastGuid: newPodcastGuid({ ownerSlug: owner.slug, slug }),
        imageUrl: showImageUrl,
        createdAt,
        updatedAt: createdAt,
      }
      const inserted = await db.insert(shows).values(values).onConflictDoNothing({ target: shows.id }).returning({ id: shows.id })
      created = inserted.length > 0
    }
    totals.shows++

    const existing = await existingEpisodeIds(show.episodes.map((episode) => episode.id))
    const episodeSlugs = already ? await takenEpisodeSlugs(show.id) : new Set(reservedEpisodeSlugs)
    const reported: Report['shows'][number]['episodes'] = []
    for (const episode of show.episodes) {
      const episodeSlug = firstFreeSlug(slugify(episode.title, 'episode'), episodeSlugs)
      episodeSlugs.add(episodeSlug)
      totals[episode.kind]++
      if (episode.imageSource) totals.episodeImages++

      let audio: { sizeBytes: number; durationSeconds: number | null } | null = null
      if (episode.kind === 'audio' && write) audio = await stageAudio(episode)
      const durationSeconds = audio?.durationSeconds ?? episode.durationSeconds
      if (durationSeconds) totals.seconds += durationSeconds
      const episodeImageUrl =
        episode.imageSource && write ? await stageImage(episode.imageSource, imageId('episode', episode.entryId), episode.title) : null

      let episodeCreated = false
      if (options.apply && !existing.has(episode.id)) {
        const when = episode.createdAt ?? createdAt
        const values: NewEpisode & { slug: string } = {
          id: episode.id,
          showId: show.id,
          title: episode.title,
          slug: episodeSlug,
          sourceUrl: episode.sourceUrl,
          imageUrl: episodeImageUrl,
          publishedAt: when,
          createdAt: when,
          updatedAt: when,
          priority: 0,
          ...(episode.kind === 'audio'
            ? {
                status: 'ready',
                audioUrl: episodeAudioUrl(episode.id),
                audioMimeType: 'audio/mpeg',
                audioSizeBytes: audio!.sizeBytes,
                durationSeconds,
              }
            : episode.kind === 'link'
              ? { status: 'pending' }
              : { status: 'failed', error: placeholderError }),
        }
        const inserted = await db.insert(episodes).values(values).onConflictDoNothing({ target: episodes.id }).returning({ id: episodes.id })
        episodeCreated = inserted.length > 0
      }
      reported.push({ entryId: episode.entryId, id: episode.id, slug: episodeSlug, kind: episode.kind, created: episodeCreated })
    }
    report.shows.push({ podcastId: show.podcastId, id: show.id, slug, title: show.title, created, episodes: reported })
  }

  console.log(
    `\n${totals.shows} shows, ${totals.audio + totals.link + totals.placeholder} episodes: ${totals.audio} with audio (${hours(totals.seconds)} hours), ${totals.link} to download from links, ${totals.placeholder} without either; artwork for ${totals.showImages} shows and ${totals.episodeImages} episodes.`,
  )

  if (options.apply) {
    if (options.ownerName && !owner.name) {
      await db.update(users).set({ name: options.ownerName }).where(eq(users.id, owner.id))
      console.log(`Named the owner "${options.ownerName}".`)
    }
    if (options.userAlias) console.log(`Old slug ${options.userAlias}: ${await addUserAlias(owner.id, options.userAlias)}.`)
    const created = report.shows.filter((show) => show.created).length
    const createdEpisodes = report.shows.reduce((sum, show) => sum + show.episodes.filter((episode) => episode.created).length, 0)
    console.log(`Created ${created} shows and ${createdEpisodes} episodes.`)
  }
  if (options.report) {
    await mkdir(dirname(options.report), { recursive: true })
    await writeFile(options.report, JSON.stringify(report, null, 2))
    console.log(`Report written to ${options.report}`)
  }
}

try {
  await main()
} catch (error) {
  console.error(error)
  process.exit(1)
}
// The app's database client keeps the process alive.
process.exit(0)
