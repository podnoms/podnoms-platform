import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { getAdminUserDetail } from '~/server/admin-users.server'
import { episodeLikes, playbackPositions, playedEpisodes, playlists, showFollows } from '~/server/db/schema'
import {
  audioPath,
  episodeHlsVersionDir,
  episodeMasterPath,
  episodeSourcePath,
  episodeWaveformPath,
  imageVariantPath,
  stagedUploadPath,
} from '~/server/storage.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db, storeTestImage } from '../helpers'

beforeEach(() => resetDb(db))

async function writeBytes(path: string, bytes: number) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.alloc(bytes))
}

describe("an admin's page about a user", () => {
  it('is null for a user who does not exist', async () => {
    expect(await getAdminUserDetail(crypto.randomUUID())).toBeNull()
  })

  it("counts the user's shows and episodes and measures their files", async () => {
    const user = await createUser({ email: 'a@example.com', name: 'Ann', slug: 'ann' })
    const other = await createUser({ email: 'b@example.com' })
    const image = await storeTestImage()
    const imageBytes = (await stat(image.path)).size
    const big = await createShow(user.id, { title: 'Big', slug: 'big', imageUrl: image.url })
    const small = await createShow(user.id, { title: 'Small', slug: 'small' })
    const otherShow = await createShow(other.id)
    await db.insert(playlists).values({ userId: user.id, title: 'Mine', slug: 'mine' })

    const ready = await createEpisode(big.id, { status: 'ready', durationSeconds: 3600 })
    await writeBytes(audioPath(ready.id), 1000)
    await writeBytes(episodeMasterPath(ready.id), 2000)
    await writeBytes(join(episodeHlsVersionDir(ready.id, 'v1'), '96k', 'seg-1.m4s'), 300)
    await writeBytes(join(episodeHlsVersionDir(ready.id, 'v1'), 'master.m3u8'), 10)
    await writeBytes(episodeWaveformPath(ready.id), 50)
    // The show's artwork, resized for a page.
    await writeBytes(imageVariantPath(image.imageId, 400, 'webp'), 70)

    const pending = await createEpisode(big.id, { status: 'pending' })
    await writeBytes(episodeSourcePath(pending.id), 4000)
    await createEpisode(small.id, { status: 'failed', durationSeconds: 60 })
    await writeBytes(stagedUploadPath(user.id, 'upload-1'), 500)

    // Someone else's files aren't counted.
    const theirs = await createEpisode(otherShow.id, { status: 'ready' })
    await writeBytes(audioPath(theirs.id), 99999)

    const detail = await getAdminUserDetail(user.id)
    expect(detail).toMatchObject({
      user: { id: user.id, name: 'Ann', email: 'a@example.com', slug: 'ann' },
      episodes: 3,
      seconds: 3660,
      playlists: 1,
      disk: {
        audio: 1000,
        masters: 2000,
        hls: 310,
        waveforms: 50,
        sources: 4000,
        uploads: 500,
        images: imageBytes + 70,
        total: 1000 + 2000 + 310 + 50 + 4000 + 500 + imageBytes + 70,
      },
    })
    // Biggest on disk first.
    expect(detail!.shows.map((show) => show.title)).toEqual(['Big', 'Small'])
    expect(detail!.shows[0]).toMatchObject({
      ownerSlug: 'ann',
      slug: 'big',
      episodes: 2,
      seconds: 3600,
      statuses: { pending: 1, processing: 0, ready: 1, failed: 0 },
    })
    expect(detail!.shows[1]).toMatchObject({ episodes: 1, statuses: { failed: 1 }, disk: { total: 0 } })
  })

  it('measures audio being made to replace an episode\'s', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    const episode = await createEpisode(show.id, {
      status: 'ready',
      replacement: { sourceUrl: 'https://example.com/new' },
    })
    await writeBytes(audioPath(episode.id), 100)
    await writeBytes(audioPath(`${episode.id}.replacement`), 40)

    expect((await getAdminUserDetail(user.id))!.disk.audio).toBe(140)
  })

  it('shows what a listener with no shows does', async () => {
    const owner = await createUser()
    const show = await createShow(owner.id)
    const a = await createEpisode(show.id, { status: 'ready' })
    const b = await createEpisode(show.id, { status: 'ready' })
    const listener = await createUser()
    await db.insert(playbackPositions).values([
      { userId: listener.id, episodeId: a.id, positionSeconds: 30 },
      { userId: listener.id, episodeId: b.id, positionSeconds: 60 },
    ])
    await db.insert(playedEpisodes).values({ userId: listener.id, episodeId: a.id })
    await db.insert(episodeLikes).values({ userId: listener.id, episodeId: b.id })
    await db.insert(showFollows).values({ userId: listener.id, showId: show.id })
    // The owner's own listening isn't the listener's.
    await db.insert(episodeLikes).values({ userId: owner.id, episodeId: a.id })

    const detail = (await getAdminUserDetail(listener.id))!
    expect(detail.shows).toEqual([])
    expect(detail.listening).toMatchObject({
      started: { count: 2 },
      played: { count: 1 },
      likes: { count: 1 },
      follows: { count: 1 },
      comments: { count: 0, lastAt: null },
      devices: { count: 0, lastAt: null },
    })
    expect(detail.listening.started.lastAt).toBeInstanceOf(Date)
  })
})
