import { createFileRoute } from '@tanstack/react-router'
import { episodeHeadOptions, PublicEpisode } from '~/components/public-episode'
import { fetchEpisodePage } from '~/functions/public'
import { publicPageHead } from '~/lib/page-meta'

// An episode's public page, at /podcasts/:slug/episodes/:episodeSlug. The
// trailing underscore on $slug_ keeps it from nesting inside the podcast page's
// route. Its owner manages it at .../manage; /listen has it without the site
// around it, for sharing.
export const Route = createFileRoute('/podcasts/$slug_/episodes/$episodeSlug')({
  staticData: { publicPage: true },
  loader: ({ params }) => fetchEpisodePage({ data: { slug: params.slug, episodeSlug: params.episodeSlug } }),
  head: ({ loaderData: page }) => (page ? publicPageHead(episodeHeadOptions(page)) : {}),
  component: EpisodePage,
})

function EpisodePage() {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <PublicEpisode page={Route.useLoaderData()} />
    </div>
  )
}
