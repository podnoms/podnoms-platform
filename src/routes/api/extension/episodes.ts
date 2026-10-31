import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { linkEpisodeSchema } from '~/lib/episode-schema'
import { createEpisode } from '~/server/episodes.server'
import { extensionUserId } from '~/server/extension-api.server'

// Adds an episode from a link the browser extension found on a page (a video,
// an audio file, or the page itself), downloaded in the background like one
// added on the site. For a plain file, which yt-dlp knows nothing about, the
// extension sends what the page says about it: its title, description and
// image (og:image), the last used as the episode's artwork if the link has none.
const extensionEpisodeSchema = linkEpisodeSchema
  .pick({ showId: true, sourceUrl: true, title: true, description: true })
  .extend({ imageUrl: z.url({ protocol: /^https?$/ }).max(2000).optional() })

export const Route = createFileRoute('/api/extension/episodes')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await extensionUserId(request)
        if (userId instanceof Response) return userId
        const parsed = extensionEpisodeSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
          return new Response(parsed.error.issues[0]?.message ?? 'Invalid episode', { status: 400 })
        }
        const { imageUrl, ...input } = parsed.data
        const episode = await createEpisode(userId, input, { pageImages: imageUrl ? [imageUrl] : [] })
        if (!episode) return new Response('Show not found', { status: 404 })
        return Response.json(episode, { status: 201 })
      },
    },
  },
})
