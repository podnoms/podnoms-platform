import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { episodes } from '~/server/db/schema'
import { cleanUpMedia, failedSourceRemovedError } from '~/server/media-cleanup.server'
import {
  episodeAudioPath,
  episodeSourcePath,
  episodeWaveformPath,
  imagePath,
  imageVariantPath,
  mediaDirs,
  replacementAudioPath,
  stagedImagePath,
  stagedUploadPath,
} from '~/server/storage.server'
import { resetDb } from '../db'
import { createEpisode, createPodcast, createUser, db, exists } from '../helpers'

const day = 24 * 60 * 60 * 1000
// Files written now count as this old.
const later = (ms: number) => Date.now() + ms

async function touch(path: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, 'x')
}

const imageId = () => crypto.randomUUID()

beforeEach(() => resetDb(db))

describe('cleanUpMedia', () => {
  it("removes episode files whose episode is gone, keeping the others'", async () => {
    const podcast = await createPodcast((await createUser()).id)
    const kept = await createEpisode(podcast.id)
    const keptFiles = [episodeAudioPath(kept.id), replacementAudioPath(kept.id), episodeWaveformPath(kept.id), episodeSourcePath(kept.id)]
    const gone = crypto.randomUUID()
    const goneFiles = [episodeAudioPath(gone), replacementAudioPath(gone), episodeWaveformPath(gone), episodeSourcePath(gone)]
    for (const path of [...keptFiles, ...goneFiles]) await touch(path)

    const removed = await cleanUpMedia(later(2 * day))

    for (const path of keptFiles) expect(await exists(path)).toBe(true)
    for (const path of goneFiles) expect(await exists(path)).toBe(false)
    expect(removed).toMatchObject({ audio: 2, waveforms: 1, sources: 1 })
  })

  it('leaves orphaned files younger than a day', async () => {
    await createEpisode((await createPodcast((await createUser()).id)).id)
    const path = episodeAudioPath(crypto.randomUUID())
    await touch(path)
    await cleanUpMedia(later(day / 2))
    expect(await exists(path)).toBe(true)
  })

  it('leaves episode files alone when the database has no episodes at all', async () => {
    const path = episodeAudioPath(crypto.randomUUID())
    await touch(path)
    expect(await cleanUpMedia(later(2 * day))).toMatchObject({ audio: 0 })
    expect(await exists(path)).toBe(true)
  })

  it('removes images, and their resized copies, that nothing refers to', async () => {
    const [podcastImage, episodeImage, userImage, unused] = [imageId(), imageId(), imageId(), imageId()]
    const user = await createUser({ image: `/images/${userImage}.jpg` })
    const podcast = await createPodcast(user.id, { imageUrl: `/images/${podcastImage}.jpg` })
    await createEpisode(podcast.id, { imageUrl: `/images/${episodeImage}.jpg` })
    for (const id of [podcastImage, episodeImage, userImage, unused]) {
      await touch(imagePath(id))
      await touch(imageVariantPath(id, 128, 'webp'))
    }
    await touch(`${imagePath(unused)}.original`)

    const removed = await cleanUpMedia(later(2 * day))

    for (const id of [podcastImage, episodeImage, userImage]) {
      expect(await exists(imagePath(id))).toBe(true)
      expect(await exists(imageVariantPath(id, 128, 'webp'))).toBe(true)
    }
    expect(await exists(imagePath(unused))).toBe(false)
    expect(await exists(imageVariantPath(unused, 128, 'webp'))).toBe(false)
    expect(removed).toMatchObject({ images: 2, imageVariants: 1 })
  })

  it("removes staged uploads and images after a day, and users' emptied folders", async () => {
    const user = await createUser()
    const upload = stagedUploadPath(user.id, crypto.randomUUID())
    const image = stagedImagePath(user.id, imageId())
    await touch(upload)
    await touch(image)

    expect(await cleanUpMedia(later(day / 2))).toMatchObject({ stagedUploads: 0, stagedImages: 0 })
    expect(await exists(upload)).toBe(true)

    expect(await cleanUpMedia(later(2 * day))).toMatchObject({ stagedUploads: 1, stagedImages: 1 })
    expect(await exists(upload)).toBe(false)
    expect(await exists(image)).toBe(false)
    expect(await exists(dirname(upload))).toBe(false)
    expect(await exists(join(mediaDirs.uploads))).toBe(true)
  })

  it('removes the kept upload of an episode failed for a week, saying to upload it again', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const failed = await createEpisode(podcast.id, { status: 'failed', error: 'ffmpeg failed', sourceUrl: null })
    await touch(episodeSourcePath(failed.id))

    expect(await cleanUpMedia(later(6 * day))).toMatchObject({ failedSources: 0 })
    expect(await exists(episodeSourcePath(failed.id))).toBe(true)

    expect(await cleanUpMedia(later(8 * day))).toMatchObject({ failedSources: 1 })
    expect(await exists(episodeSourcePath(failed.id))).toBe(false)
    const [row] = await db.select().from(episodes).where(eq(episodes.id, failed.id))
    expect(row).toMatchObject({ status: 'failed', error: failedSourceRemovedError })
  })

  it('keeps the files of failed episodes from links, and of other episodes, however old', async () => {
    const podcast = await createPodcast((await createUser()).id)
    const fromLink = await createEpisode(podcast.id, { status: 'failed', sourceUrl: 'https://video.test/x' })
    const pending = await createEpisode(podcast.id, { status: 'pending', sourceUrl: null })
    for (const { id } of [fromLink, pending]) await touch(episodeSourcePath(id))

    expect(await cleanUpMedia(later(30 * day))).toMatchObject({ failedSources: 0, sources: 0 })
    for (const { id } of [fromLink, pending]) expect(await exists(episodeSourcePath(id))).toBe(true)
  })

  it('reports nothing removed when there is nothing to remove', async () => {
    expect(await cleanUpMedia()).toEqual({
      failedSources: 0,
      audio: 0,
      waveforms: 0,
      sources: 0,
      images: 0,
      imageVariants: 0,
      stagedUploads: 0,
      stagedImages: 0,
    })
  })
})
