// Fills the database in .env with fake podcasts and episodes for development:
// 50 podcasts with 20–100 episodes each, owned by the first user (or the user
// with the email given as an argument). Episodes have no audio, so they show
// as ready but can't be played and are left out of feeds.
//
//   bun run db:seed [email]
//
// Images are remote URLs; the app downloads them into MEDIA_DIR the first
// time a podcast page is opened (see localiseRemoteImages).
import { faker } from '@faker-js/faker'
import { asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { plainTextToHtml } from '~/lib/rich-text'
import { firstFreeSlug, slugify } from '~/lib/slug'
import { episodes, podcasts, users, type NewEpisode } from '~/server/db/schema'

const podcastCount = 50
const minEpisodes = 20
const maxEpisodes = 100

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required (bun loads it from .env)')

const client = postgres(databaseUrl, { max: 1 })
const db = drizzle(client)

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

function episodeTitle(number: number) {
  return faker.helpers.arrayElement([
    () => `#${number} ${faker.music.songName()}`,
    () => `${faker.company.catchPhrase()}`,
    () => `${faker.person.fullName()} on ${faker.word.noun()}s`,
    () => `${faker.music.genre()} mix, ${faker.date.past({ years: 3 }).toLocaleDateString('en-IE', { month: 'long', year: 'numeric' })}`,
  ])()
}

try {
  const email = process.argv[2]
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
      return {
        podcastId: podcast!.id,
        title,
        slug,
        description: paragraphs(faker.number.int({ min: 1, max: 4 })),
        // Some episodes use the podcast's artwork.
        imageUrl: faker.datatype.boolean(0.7) ? image() : null,
        durationSeconds: faker.number.int({ min: 15 * 60, max: 3 * 60 * 60 }),
        status: 'ready',
        publishedAt,
        createdAt: publishedAt,
      }
    })
    await db.insert(episodes).values(rows)
    episodeTotal += rows.length
    console.log(`${String(i + 1).padStart(2)}/${podcastCount} ${title} (${rows.length} episodes)`)
  }

  console.log(`\nAdded ${podcastCount} podcasts and ${episodeTotal} episodes for ${owner.email ?? owner.id}.`)
} finally {
  await client.end()
}
