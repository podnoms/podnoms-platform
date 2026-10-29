import { createFileRoute } from '@tanstack/react-router'
import { siteUrl } from '~/server/extension-api.server'
import { mobileApiUserId } from '~/server/mobile-auth.server'
import { getProfile } from '~/server/users.server'

// Who the mobile app is signed in as.
export const Route = createFileRoute('/api/mobile/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await mobileApiUserId(request)
        if (userId instanceof Response) return userId
        const profile = await getProfile(userId)
        if (!profile) return new Response('You need to be signed in', { status: 401 })
        return Response.json({
          id: userId,
          name: profile.name,
          slug: profile.slug,
          email: profile.email,
          imageUrl: profile.imageUrl && siteUrl(request, profile.imageUrl),
          isAdmin: profile.isAdmin,
        })
      },
    },
  },
})
