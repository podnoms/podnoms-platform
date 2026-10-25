import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createFileRoute } from '@tanstack/react-router'
import { fontBySlug } from '~/lib/theme-fonts'
import { fontStylesheet } from '~/server/fonts.server'
import { fontFilePath } from '~/server/storage.server'

// The theme's fonts (see fonts.server.ts): font.css, the font's stylesheet,
// downloaded from Google on first request, and the font files it names, which
// never change.
export const Route = createFileRoute('/fonts/$family/$file')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const name = fontBySlug(params.family)
        if (!name) return new Response('Not found', { status: 404 })
        if (params.file === 'font.css') {
          const css = await fontStylesheet(name)
          if (!css) return new Response("Couldn't get that font", { status: 502, headers: { 'Cache-Control': 'no-store' } })
          return new Response(await readFile(css, 'utf8'), {
            headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
          })
        }
        if (!/^[0-9a-f]{16}\.woff2$/.test(params.file)) return new Response('Not found', { status: 404 })
        const path = fontFilePath(params.family, params.file)
        if (!existsSync(path)) return new Response('Not found', { status: 404 })
        return new Response(new Uint8Array(await readFile(path)), {
          headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' },
        })
      },
    },
  },
})
