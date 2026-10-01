import { createFileRoute } from '@tanstack/react-router'
import { getSession } from '~/server/auth.server'
import { maxImageBytes, stageImage } from '~/server/images.server'
import { UploadError } from '~/server/uploads.server'

// Receives an image for a podcast or episode, as the raw request body. It's
// converted and staged; saving the podcast or episode with its ID keeps it.
export const Route = createFileRoute('/api/images')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getSession(request)
        if (!session?.user?.id) return new Response('You need to be signed in', { status: 401 })
        if (!request.body) return new Response('No image was sent', { status: 400 })
        if (Number(request.headers.get('content-length')) > maxImageBytes) {
          return new Response('That image is too big to upload', { status: 413 })
        }
        try {
          return Response.json(await stageImage(session.user.id, request.body))
        } catch (error) {
          if (error instanceof UploadError) return new Response(error.message, { status: error.status })
          throw error
        }
      },
    },
  },
})
