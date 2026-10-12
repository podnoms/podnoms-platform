// Making a broadcast's recording into an episode once it ends. MediaMTX
// records each stream into podcastLiveRecordingsDir, starting a new file
// whenever the stream (re)connects; the files of this broadcast are joined
// into the episode's source, and the processor converts it as it would an
// upload. The episode is private, so the owner can look it over (and trim the
// title) before publishing it.
import '@tanstack/react-start/server-only'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '~/server/db/client.server'
import { liveBroadcasts, type LiveBroadcast } from '~/server/db/schema'
import { availableEpisodeSlug } from '~/server/episode-slugs.server'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { insertEpisode } from '~/server/episodes.server'
import { logger } from '~/server/logger.server'
import { joinAudio } from '~/server/media.server'
import { ensureSourcesDir, episodeSourcePath, podcastLiveRecordingsDir } from '~/server/storage.server'

// A file still being written when the broadcast was first seen was changed
// after it started, so anything changed since a little before is this
// broadcast's; older files belong to broadcasts already dealt with.
const startSlackMs = 60_000

// The broadcast's recording files, in the order they were made (MediaMTX
// names them by the time they start).
export async function broadcastRecordings(broadcast: Pick<LiveBroadcast, 'podcastId' | 'startedAt'>) {
  const dir = podcastLiveRecordingsDir(broadcast.podcastId)
  const names = await readdir(dir).catch(() => [] as string[])
  const files: string[] = []
  for (const name of names.sort()) {
    const path = join(dir, name)
    const info = await stat(path).catch(() => null)
    if (info?.isFile() && info.size > 0 && info.mtimeMs >= broadcast.startedAt.getTime() - startSlackMs) files.push(path)
  }
  return files
}

// Makes the ended broadcast's recording into a private episode, queued for
// conversion, and removes the recording files. Does nothing if nothing was
// recorded. Returns the episode's id, if one was made.
export async function finishRecording(broadcast: LiveBroadcast) {
  const files = await broadcastRecordings(broadcast)
  if (files.length === 0) {
    logger.warn({ broadcastId: broadcast.id }, 'Broadcast ended with no recording')
    return null
  }
  const episode = await insertEpisode({
    podcastId: broadcast.podcastId,
    title: broadcast.title,
    slug: await availableEpisodeSlug(broadcast.podcastId, broadcast.title),
    private: true,
    publishedAt: broadcast.startedAt,
  })
  try {
    await ensureSourcesDir()
    await joinAudio(files, episodeSourcePath(episode.id))
  } catch (error) {
    // The processor will mark it failed, saying the file is missing; the
    // recording is kept so nothing is lost.
    enqueueEpisode(episode.id)
    await db.update(liveBroadcasts).set({ episodeId: episode.id }).where(eq(liveBroadcasts.id, broadcast.id))
    throw error
  }
  await db.update(liveBroadcasts).set({ episodeId: episode.id }).where(eq(liveBroadcasts.id, broadcast.id))
  enqueueEpisode(episode.id)
  await Promise.all(files.map((file) => rm(file, { force: true })))
  logger.info({ broadcastId: broadcast.id, episodeId: episode.id, files: files.length }, 'Broadcast recording queued as an episode')
  return episode.id
}
