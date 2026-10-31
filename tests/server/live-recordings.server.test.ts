import { utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { episodes, liveBroadcasts } from '~/server/db/schema'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { finishRecording } from '~/server/live-recordings.server'
import { probeAudio } from '~/server/media.server'
import { episodeSourcePath, showLiveRecordingsDir } from '~/server/storage.server'
import { resetDb } from '../db'
import { createShow, createUser, db, exists, hasFfmpeg, makeTone } from '../helpers'

vi.mock('~/server/episode-processor.server', () => ({ enqueueEpisode: vi.fn() }))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(enqueueEpisode).mockClear()
})

async function endedBroadcast(showId: string, startedAt: Date) {
  const [broadcast] = await db
    .insert(liveBroadcasts)
    .values({ showId, title: 'Friday night live', startedAt, lastSeenAt: new Date(), endedAt: new Date() })
    .returning()
  return broadcast!
}

// A segment as MediaMTX records one: fragmented MP4, named by when it started.
const segment = (dir: string, name: string, seconds: number) =>
  makeTone(join(dir, `${name}.mp4`), seconds, ['-c:a', 'aac', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov'])

describe.skipIf(!hasFfmpeg)('finishRecording', () => {
  it("joins the broadcast's segments into a private episode, queued for conversion", async () => {
    const show = await createShow((await createUser()).id)
    const startedAt = new Date(Date.now() - 10_000)
    const broadcast = await endedBroadcast(show.id, startedAt)
    const dir = showLiveRecordingsDir(show.id)
    // From a broadcast long ago, whose episode failed: not this one's.
    const old = await segment(dir, '2026-10-01_20-00-00-000000', 1)
    await utimes(old, new Date('2026-10-01T21:00:00Z'), new Date('2026-10-01T21:00:00Z'))
    const parts = [await segment(dir, '2026-10-12_20-00-00-000000', 2), await segment(dir, '2026-10-12_20-05-00-000000', 2)]

    const episodeId = await finishRecording(broadcast)

    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId!))
    expect(episode).toMatchObject({
      showId: show.id,
      title: 'Friday night live',
      slug: 'friday-night-live',
      private: true,
      status: 'pending',
      sourceUrl: null,
      publishedAt: startedAt,
    })
    expect(enqueueEpisode).toHaveBeenCalledWith(episodeId)
    const source = await probeAudio(episodeSourcePath(episodeId!))
    expect(source?.codec).toBe('aac')
    expect(source?.durationSeconds).toBe(4)
    expect((await db.select().from(liveBroadcasts))[0]!.episodeId).toBe(episodeId)
    for (const part of parts) expect(await exists(part)).toBe(false)
    expect(await exists(old)).toBe(true)
  })

  it('makes no episode when nothing was recorded', async () => {
    const show = await createShow((await createUser()).id)
    const broadcast = await endedBroadcast(show.id, new Date())

    expect(await finishRecording(broadcast)).toBeNull()
    expect(await db.select().from(episodes)).toEqual([])
    expect(enqueueEpisode).not.toHaveBeenCalled()
  })
})
