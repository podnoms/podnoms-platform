import { createFileRoute } from '@tanstack/react-router'
import { deleteEpisode } from '~/server/episodes.server'
import { mobileEpisodePage } from '~/server/mobile-api.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

export const Route = createFileRoute('/api/mobile/episodes/$id/')({
  server: {
    handlers: {
      // An episode's page: the episode, its show and its comments.
      GET: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const page = await mobileEpisodePage(request, userId, params.id)
        if (!page) return new Response('Not found', { status: 404 })
        return Response.json(page)
      },
      // Deletes one of the user's episodes; not while it's downloading.
      DELETE: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        if (!(await deleteEpisode(userId, params.id))) return new Response("That episode can't be deleted", { status: 409 })
        return new Response(null, { status: 204 })
      },
    },
  },
})
