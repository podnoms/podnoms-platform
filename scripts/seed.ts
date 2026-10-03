// Fills the database in .env with fake podcasts and episodes for development:
// 50 podcasts with 20–100 episodes each, owned by the first user (or the user
// with the email given as an argument). Every episode plays the same minute
// of generated audio, with the same waveform: one MP3 and one waveform file in
// MEDIA_DIR/seed, hard-linked to each episode's paths, so they take no extra
// space and deleting an episode leaves the others alone.
//
//   bun run db:seed [email]
//   bun run db:seed --audio-only    gives the sample audio to every ready
//                                   episode that has none, and adds nothing
//
// Images are remote URLs; the app downloads them into MEDIA_DIR the first
// time a podcast page is opened (see localiseRemoteImages).
import { execFileSync } from 'node:child_process'
import { copyFile, link, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { faker } from '@faker-js/faker'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { env } from '~/env'
import { plainTextToHtml } from '~/lib/rich-text'
import { firstFreeSlug, slugify } from '~/lib/slug'
import { db } from '~/server/db/client.server'
import { episodes, podcasts, users, type NewEpisode } from '~/server/db/schema'
import { ensureAudioDir, episodeAudioPath, episodeAudioUrl, episodeWaveformPath } from '~/server/storage.server'
import { computeWaveform } from '~/server/waveforms.server'

const podcastCount = 50
const minEpisodes = 20
const maxEpisodes = 100

const sampleSeconds = 60
const sampleDir = resolve(env.MEDIA_DIR, 'seed')
const sampleAudio = resolve(sampleDir, 'sample.mp3')
const sampleWaveform = resolve(sampleDir, 'sample-waveform.json')

const image = () => faker.image.urlPicsumPhotos({ width: 600, height: 600, grayscale: false, blur: 0 })
const paragraphs = (count: number) => plainTextToHtml(faker.lorem.paragraphs(count, '\n\n'))

function podcastTitle() {
  return faker.helpers.arrayElement([
    () => `The ${faker.word.adjective()} ${faker.word.noun()}`,
    () => `${faker.person.firstName()}'s ${faker.music.genre()} Hour`,
    () => `${faker.company.buzzNoun()} ${faker.helpers.arrayElement(['Weekly', 'Daily', 'Radio', 'Sessions', 'Talk'])}`,
    () => `${faker.music.genre()} ${faker.helpers.arrayElement(['Mixes', 'Diaries', 'Selections', 'Live'])}`,
  ])()
    .replace(/(^|\s)(\w)/g, (_, space: string, letter: string) => space + letter.toUpperCase())
}

// Makes the sample audio and its waveform, once: a tone that swells and fades
// every few seconds, so the waveform has some shape.
async function ensureSample() {
  if (await stat(sampleWaveform).catch(() => null)) return (await stat(sampleAudio)).size
  await mkdir(sampleDir, { recursive: true })
  const tone = `0.5*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*t/6))+0.2*sin(2*PI*330*t)*(0.5+0.5*sin(2*PI*t/11))`
  execFileSync(env.FFMPEG_PATH, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `aevalsrc=${tone}:s=44100:d=${sampleSeconds}`,
    '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '96k', sampleAudio,
  ])
  await writeFile(sampleWaveform, JSON.stringify(await computeWaveform(sampleAudio)))
  return (await stat(sampleAudio)).size
}

// Gives the episode its own path to the shared file: a hard link, or a copy
// where linking isn't possible (e.g. across filesystems).
async function share(source: string, target: string) {
  await mkdir(dirname(target), { recursive: true })
  await rm(target, { force: true })
  await link(source, target).catch(() => copyFile(source, target))
}

async function addSampleAudio(episodeIds: string[]) {
  await ensureAudioDir()
  for (const id of episodeIds) {
    await share(sampleAudio, episodeAudioPath(id))
    await share(sampleWaveform, episodeWaveformPath(id))
  }
}

const sampleAudioColumns = (id: string, size: number) => ({
  audioUrl: episodeAudioUrl(id),
  audioMimeType: 'audio/mpeg',
  audioSizeBytes: size,
  durationSeconds: sampleSeconds,
})

function episodeTitle(number: number) {
  return faker.helpers.arrayElement([
    () => `#${number} ${faker.music.songName()}`,
    () => `${faker.company.catchPhrase()}`,
    () => `${faker.person.fullName()} on ${faker.word.noun()}s`,
    () => `${faker.music.genre()} mix, ${faker.date.past({ years: 3 }).toLocaleDateString('en-IE', { month: 'long', year: 'numeric' })}`,
  ])()
}

async function backfillAudio(size: number) {
  const missing = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.status, 'ready'), isNull(episodes.audioUrl)))
  const ids = missing.map((row) => row.id)
  await addSampleAudio(ids)
  for (const id of ids) await db.update(episodes).set(sampleAudioColumns(id, size)).where(eq(episodes.id, id))
  console.log(`Gave ${ids.length} episodes the sample audio.`)
}

try {
  const args = process.argv.slice(2)
  const size = await ensureSample()
  if (args.includes('--audio-only')) {
    await backfillAudio(size)
    process.exit(0)
  }

  const email = args.find((arg) => !arg.startsWith('--'))
  const [owner] = email
    ? await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email)).limit(1)
    : // No sign-up time is stored; table order is the closest to "first".
      await db.select({ id: users.id, email: users.email }).from(users).orderBy(asc(sql`ctid`)).limit(1)
  if (!owner) throw new Error(email ? `No user with the email ${email}` : 'There are no users; sign up first')

  // Podcast slugs are unique across all users.
  const takenPodcastSlugs = new Set((await db.select({ slug: podcasts.slug }).from(podcasts)).map((row) => row.slug))
  let episodeTotal = 0

  for (let i = 0; i < podcastCount; i++) {
    const title = podcastTitle()
    const slug = firstFreeSlug(slugify(title, 'podcast'), takenPodcastSlugs)
    takenPodcastSlugs.add(slug)
    const [podcast] = await db
      .insert(podcasts)
      .values({
        userId: owner.id,
        title,
        slug,
        description: paragraphs(faker.number.int({ min: 1, max: 3 })),
        imageUrl: image(),
        category: faker.helpers.arrayElement(['Music', 'Comedy', 'Technology', 'News', 'Arts', 'Education']),
        explicit: faker.datatype.boolean(0.1),
      })
      .returning({ id: podcasts.id })

    const count = faker.number.int({ min: minEpisodes, max: maxEpisodes })
    const takenEpisodeSlugs = new Set<string>()
    const dates = faker.date.betweens({ from: faker.date.past({ years: 5 }), to: new Date(), count })
    const rows: NewEpisode[] = dates.map((publishedAt, n) => {
      const title = episodeTitle(n + 1)
      const slug = firstFreeSlug(slugify(title, 'episode'), takenEpisodeSlugs)
      takenEpisodeSlugs.add(slug)
      const id = crypto.randomUUID()
      return {
        id,
        podcastId: podcast!.id,
        title,
        slug,
        description: paragraphs(faker.number.int({ min: 1, max: 4 })),
        // Some episodes use the podcast's artwork.
        imageUrl: faker.datatype.boolean(0.7) ? image() : null,
        ...sampleAudioColumns(id, size),
        status: 'ready',
        publishedAt,
        createdAt: publishedAt,
      }
    })
    await addSampleAudio(rows.map((row) => row.id!))
    await db.insert(episodes).values(rows)
    episodeTotal += rows.length
    console.log(`${String(i + 1).padStart(2)}/${podcastCount} ${title} (${rows.length} episodes)`)
  }

  console.log(`\nAdded ${podcastCount} podcasts and ${episodeTotal} episodes for ${owner.email ?? owner.id}.`)
} catch (error) {
  console.error(error)
  process.exit(1)
}
// The app's database client keeps the process alive.
process.exit(0)
