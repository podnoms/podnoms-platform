import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  archiveDeletedShow,
  deletedShowMedia,
  deletedShowRetentionMs,
  purgeDeletedShows,
  writeDeletedShowManifest,
  type DeletedShowManifest,
} from '~/server/deleted-shows.server'
import {
  deletedShowDir,
  episodeAudioPath,
  episodeSourcePath,
  episodeWaveformPath,
  imagePath,
  imageUrl,
  imageVariantPath,
  showLiveRecordingsDir,
} from '~/server/storage.server'
import { exists } from '../helpers'

const day = 24 * 60 * 60 * 1000

async function touch(path: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, 'x')
}

function manifest(values: Partial<DeletedShowManifest> = {}): DeletedShowManifest {
  return {
    id: crypto.randomUUID(),
    title: 'Mixes',
    slug: 'mixes',
    userId: 'u1',
    imageUrl: null,
    deletedAt: new Date().toISOString(),
    episodes: [],
    ...values,
  }
}

describe('archiveDeletedShow', () => {
  it("moves the show's files beside its manifest, dropping resized images", async () => {
    const [episodeId, showImage, episodeImage] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    const show = manifest({
      imageUrl: imageUrl(showImage),
      episodes: [{ id: episodeId, title: 'One', slug: 'one', imageUrl: imageUrl(episodeImage) }],
    })
    const recording = join(showLiveRecordingsDir(show.id), '2026-10-01_20-00-00.mp4')
    const variant = imageVariantPath(showImage, 256, 'webp')
    const files = [episodeAudioPath(episodeId), episodeWaveformPath(episodeId), imagePath(showImage), imagePath(episodeImage), recording, variant]
    for (const path of files) await touch(path)
    await writeDeletedShowManifest(show)

    expect(await archiveDeletedShow(show.id)).toEqual({ moved: 5 })

    for (const path of files) expect(await exists(path)).toBe(false)
    const dir = deletedShowDir(show.id)
    for (const path of [
      join(dir, 'audio', `${episodeId}.mp3`),
      join(dir, 'waveforms', `${episodeId}.json`),
      join(dir, 'images', `${showImage}.jpg`),
      join(dir, 'images', `${episodeImage}.jpg`),
      join(dir, 'live-recordings', show.id, '2026-10-01_20-00-00.mp4'),
    ]) {
      expect(await exists(path)).toBe(true)
    }
  })

  it('can run again, and does nothing without a manifest', async () => {
    const episodeId = crypto.randomUUID()
    const show = manifest({ episodes: [{ id: episodeId, title: 'One', slug: 'one', imageUrl: null }] })
    await touch(episodeSourcePath(episodeId))
    await writeDeletedShowManifest(show)
    expect(await archiveDeletedShow(show.id)).toEqual({ moved: 1 })
    expect(await archiveDeletedShow(show.id)).toEqual({ moved: 0 })
    expect(await exists(join(deletedShowDir(show.id), 'sources', episodeId))).toBe(true)
    expect(await archiveDeletedShow(crypto.randomUUID())).toEqual({ moved: 0 })
  })
})

describe('deletedShowMedia', () => {
  it("lists deleted shows' episodes and images", async () => {
    const [episodeId, image] = [crypto.randomUUID(), crypto.randomUUID()]
    const show = manifest({ imageUrl: imageUrl(image), episodes: [{ id: episodeId, title: 'One', slug: 'one', imageUrl: null }] })
    await writeDeletedShowManifest(show)
    const media = await deletedShowMedia()
    expect(media.showIds.has(show.id)).toBe(true)
    expect(media.episodeIds.has(episodeId)).toBe(true)
    expect(media.imageIds.has(image)).toBe(true)
  })
})

describe('purgeDeletedShows', () => {
  it('removes a deleted show’s folder once it has been kept 30 days, not before', async () => {
    const show = manifest({ deletedAt: new Date('2026-09-01T00:00:00Z').toISOString() })
    await writeDeletedShowManifest(show)
    await touch(join(deletedShowDir(show.id), 'audio', 'a.mp3'))
    const deletedAt = Date.parse(show.deletedAt)

    await purgeDeletedShows(deletedAt + deletedShowRetentionMs - day)
    expect(await exists(deletedShowDir(show.id))).toBe(true)

    await purgeDeletedShows(deletedAt + deletedShowRetentionMs)
    expect(await exists(deletedShowDir(show.id))).toBe(false)
  })

  it("goes by the folder's age when its manifest is missing", async () => {
    const dir = deletedShowDir(crypto.randomUUID())
    await touch(join(dir, 'audio', 'a.mp3'))
    const old = new Date(Date.now() - 31 * day)
    await utimes(dir, old, old)
    await purgeDeletedShows()
    expect(await exists(dir)).toBe(false)
  })
})
