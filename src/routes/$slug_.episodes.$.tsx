import { createFileRoute, redirect } from '@tanstack/react-router'

// Episodes used to be at /:slug/episodes/:episodeSlug (and .../manage), which
// feeds, emails and shared links still point to: send them to /:slug/:episodeSlug.
export const Route = createFileRoute('/$slug_/episodes/$')({
  beforeLoad: ({ params }) => {
    throw redirect({ href: `/${encodeURIComponent(params.slug)}/${params._splat ?? ''}`, statusCode: 301 })
  },
})
