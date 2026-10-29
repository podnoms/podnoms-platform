import { createFileRoute } from '@tanstack/react-router'
import { mobileCommentSchema } from '~/lib/mobile-schema'
import { addComment } from '~/server/comments.server'
import { mobileComment } from '~/server/mobile-api.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Comments on an episode, or replies, as on the site (comments.server.ts):
// @slugs become mentions, and whoever's mentioned or replied to is told.
// Returns all the episode's comments, the new one among them.
export const Route = createFileRoute('/api/mobile/episodes/$id/comments')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const parsed = mobileCommentSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response(parsed.error.issues[0]?.message ?? 'Invalid comment', { status: 400 })
        const { body, atSeconds, parentId } = parsed.data
        const comments = await addComment(userId, params.id, body, atSeconds, parentId)
        if (!comments) return new Response('Not found', { status: 404 })
        return Response.json(comments.map((comment) => mobileComment(request, comment)), { status: 201 })
      },
    },
  },
})
