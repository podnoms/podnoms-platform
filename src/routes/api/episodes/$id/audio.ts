import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { recordActivity } from '~/server/activity.server'
import { getEpisodeAudio } from '~/server/episodes.server'
import { reportError } from '~/server/logger.server'
import { episodeAudioPath } from '~/server/storage.server'

// Serves an episode's audio. Supports Range requests, which players need to
// seek and which podcast apps expect. Counts as a download for the podcast's
// stats, except for the site's own players, which report plays instead.
export const Route = createFileRoute('/api/episodes/$id/audio')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const episode = await getEpisodeAudio(params.id)
        if (!episode) return new Response('Not found', { status: 404 })

        const path = episodeAudioPath(params.id)
        const size = await stat(path).then((s) => s.size, () => null)
        if (size === null) return new Response('Not found', { status: 404 })

        const headers = new Headers({
          'Accept-Ranges': 'bytes',
          'Content-Type': episode.audioMimeType ?? 'audio/mpeg',
        })
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
        if (!range || (!range[1] && !range[2])) {
          headers.set('Content-Length', String(size))
          countDownload(request, params.id, size)
          return new Response(stream(path), { headers })
        }

        // "bytes=500-" (from 500), "bytes=500-999", or "bytes=-500" (last 500).
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
        if (start >= size || start > end) {
          headers.set('Content-Range', `bytes */${size}`)
          return new Response(null, { status: 416, headers })
        }
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
        headers.set('Content-Length', String(end - start + 1))
        countDownload(request, params.id, end - start + 1)
        return new Response(stream(path, start, end), { status: 206, headers })
      },
    },
  },
})

// Apps check a file with tiny requests (Apple's for its first two bytes)
// before fetching it; those aren't downloads.
const probeBytes = 1024

function countDownload(request: Request, episodeId: string, bytes: number) {
  // Browsers say when an <audio> element is fetching, as the site's players
  // do; a download link or another app doesn't.
  const destination = request.headers.get('sec-fetch-dest')
  if (destination === 'audio' || destination === 'video' || bytes <= probeBytes) return
  // In the background, so the audio isn't held up.
  recordActivity(request, { episodeId, type: 'download', source: 'app' }).catch((error: unknown) =>
    reportError(error, { episodeId, msg: 'Could not record a download' }),
  )
}

function stream(path: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
}
