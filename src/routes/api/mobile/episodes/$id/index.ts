import { createFileRoute } from '@tanstack/react-router'
import { deleteEpisode } from '~/server/episodes.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Deletes one of the user's episodes; not while it's downloading.
export const Route = createFileRoute('/api/mobile/episodes/$id/')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        if (!(await deleteEpisode(userId, params.id))) return new Response("That episode can't be deleted", { status: 409 })
        return new Response(null, { status: 204 })
      },
    },
  },
})
