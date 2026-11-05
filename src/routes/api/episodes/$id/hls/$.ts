import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { getEpisodeAudio } from '~/server/episodes.server'
import { entryPlaylist, hlsFilePath } from '~/server/hls.server'
import { requestUserId } from '~/server/mobile-auth.server'

// An episode's HLS stream (see hls.server.ts). `master.m3u8` is the entry
// playlist, for those the audio endpoint would serve (owner signed in or the
// app's token, or a private show's feed key); 404 until the stream is built,
// when players use the MP3. Everything else is `<version>/<file>`, or
// `<version>/s/<signature>/<file>` for episodes that aren't public. None of it
// counts as a download: the players report plays.
//
// Caching is plain Cache-Control, so any CDN or caching proxy in front (or
// none) handles it: a version never changes, so public files are immutable,
// but shared caches keep them only a day, in case the episode leaves public
// view (when its stream moves to a new version).
const publicFile = 'public, max-age=31536000, immutable, s-maxage=86400'
const privateFile = 'private, max-age=86400'

const versionedFile = /^([\w-]+)\/(?:s\/([\w.-]+)\/)?(.+)$/

export const Route = createFileRoute('/api/episodes/$id/hls/$')({
  server: {
    handlers: {
      // HEAD is answered from this too, without the body.
      GET: ({ request, params }) => serve(request, params.id, params._splat ?? ''),
    },
  },
})

async function serve(request: Request, episodeId: string, splat: string) {
  if (splat === 'master.m3u8') {
    const episode = await getEpisodeAudio(episodeId, {
      key: new URL(request.url).searchParams.get('key'),
      viewerId: () => requestUserId(request),
    })
    const body = episode && (await entryPlaylist(episodeId, episode))
    if (!body) return new Response('Not found', { status: 404 })
    return new Response(body, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        // It names the current version, which changes, and for others than
        // the public it's signed for whoever asked.
        'Cache-Control': episode.public ? 'public, no-cache' : 'private, no-store',
      },
    })
  }

  const match = versionedFile.exec(splat)
  if (!match) return new Response('Not found', { status: 404 })
  const [, version, signature, file] = match
  const path = await hlsFilePath(episodeId, version!, signature ?? null, file!)
  const info = path && (await stat(path).catch(() => null))
  if (!path || !info) return new Response('Not found', { status: 404 })

  const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`
  const headers = new Headers({
    'Content-Type': file!.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'audio/mp4',
    'Content-Length': String(info.size),
    'Cache-Control': signature ? privateFile : publicFile,
    ETag: etag,
    'Last-Modified': new Date(info.mtimeMs).toUTCString(),
  })
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers })
}
