import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { imageVariant } from '~/server/images.server'

// Serves stored podcast and episode artwork. `?w=` asks for a smaller copy, at
// least that wide (see imageWidths), as WebP when the browser accepts it.
// Without it, the original JPEG is served, which is what podcast feeds link to.
// Each image has its own ID and never changes, so responses are cached for good.
export const Route = createFileRoute('/images/$file')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const imageId = /^([0-9a-f-]{36})\.jpg$/.exec(params.file)?.[1]
        if (!imageId) return new Response('Not found', { status: 404 })
        const width = Number(new URL(request.url).searchParams.get('w')) || Infinity
        const webp = width !== Infinity && (request.headers.get('accept') ?? '').includes('image/webp')
        const image = await imageVariant(imageId, width, webp ? 'webp' : 'jpg')
        if (!image) return new Response('Not found', { status: 404 })
        const { size } = await stat(image.path)
        return new Response(Readable.toWeb(createReadStream(image.path)) as ReadableStream, {
          headers: {
            'Content-Type': image.format === 'webp' ? 'image/webp' : 'image/jpeg',
            'Content-Length': String(size),
            'Cache-Control': 'public, max-age=31536000, immutable',
            Vary: 'Accept',
          },
        })
      },
    },
  },
})
