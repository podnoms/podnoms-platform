import { createFileRoute } from '@tanstack/react-router'
import { maxUploadBytes } from '~/lib/episode-schema'
import { getSession } from '~/server/auth.server'
import { saveUpload, saveUploadPart, UploadError } from '~/server/uploads.server'

// Receives an audio file to turn into an episode. The body is the raw file, or
// one part of it, streamed to disk rather than parsed as a form, so large files
// aren't held in memory; its name comes in the `filename` query parameter.
export const Route = createFileRoute('/api/uploads')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSession(request)
        if (!session?.user?.id) return new Response('You need to be signed in', { status: 401 })
        if (!request.body) return new Response('No file was sent', { status: 400 })
        if (Number(request.headers.get('content-length')) > maxUploadBytes) {
          return new Response('That file is too big to upload', { status: 413 })
        }

        const params = new URL(request.url).searchParams
        const filename = params.get('filename') ?? ''
        try {
          // With `size`, the body is one part of the file (see saveUploadPart);
          // without, it's the whole file.
          if (params.has('size')) {
            const part = {
              uploadId: params.get('uploadId') || undefined,
              offset: Number(params.get('offset') ?? 0),
              size: Number(params.get('size')),
              filename,
            }
            return Response.json(await saveUploadPart(session.user.id, request.body, part))
          }
          return Response.json(await saveUpload(session.user.id, request.body, filename))
        } catch (error) {
          if (error instanceof UploadError) return new Response(error.message, { status: error.status })
          throw error
        }
      },
    },
  },
})
