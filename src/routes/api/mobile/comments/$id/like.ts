import { createFileRoute } from '@tanstack/react-router'
import { mobileCommentLikeSchema } from '~/lib/mobile-schema'
import { setCommentLike } from '~/server/comments.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'

// Likes or unlikes a comment: its like count and whether the user likes it.
export const Route = createFileRoute('/api/mobile/comments/$id/like')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const parsed = mobileCommentLikeSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return new Response('Invalid like', { status: 400 })
        const result = await setCommentLike(userId, params.id, parsed.data.like)
        if (!result) return new Response('Not found', { status: 404 })
        return Response.json(result)
      },
    },
  },
})
