import { createFileRoute } from '@tanstack/react-router'
import { brandIconSizes, type BrandIconSize } from '~/lib/branding'
import { brandIconResponse } from '~/server/branding.server'

const isIconSize = (size: number): size is BrandIconSize => (brandIconSizes as readonly number[]).includes(size)

// The site's logo (see branding.server.ts): logo.png at 512px,
// icon-<size>.png at each of brandIconSizes, and og.png, the card for link
// previews. Asked for with the current logo's ?v=, it's cached for good;
// otherwise briefly, so a new logo shows soon.
export const Route = createFileRoute('/brand/$file')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (params.file === 'og.png') return brandIconResponse(request, 'og')
        const size = params.file === 'logo.png' ? 512 : Number(/^icon-(\d+)\.png$/.exec(params.file)?.[1])
        if (!isIconSize(size)) return new Response('Not found', { status: 404 })
        return brandIconResponse(request, size)
      },
    },
  },
})
