import { createFileRoute } from '@tanstack/react-router'
import { serveEpisodeAudio } from '~/server/episode-audio.server'

// An episode's audio, as the site's players and the app ask for it. Feeds
// link to audio.mp3 beside it, which is the same thing.
export const Route = createFileRoute('/api/episodes/$id/audio')({
  server: {
    handlers: {
      GET: ({ request, params }) => serveEpisodeAudio(request, params.id),
    },
  },
})
