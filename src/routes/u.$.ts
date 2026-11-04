import { createFileRoute } from '@tanstack/react-router'

// Profiles (and public playlists) used to be under /u/<slug>; they're at
// /<slug> now.
export const Route = createFileRoute('/u/$')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        new Response(null, {
          status: 301,
          headers: { Location: `/${params._splat ?? ''}${new URL(request.url).search}` },
        }),
    },
  },
})
