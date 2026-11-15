import { createFileRoute } from '@tanstack/react-router'
import { serveEpisodeAudio } from '~/server/episode-audio.server'

// The address feeds give for an episode's audio: Apple Podcasts and feed
// validators want an enclosure's URL to end in the file's extension.
export const Route = createFileRoute('/api/episodes/$id/audio.mp3')({
  server: {
    handlers: {
      GET: ({ request, params }) => serveEpisodeAudio(request, params.id),
    },
  },
})
