import { createFileRoute } from '@tanstack/react-router'
import { episodeHeadOptions, PublicEpisode } from '~/components/public-episode'
import { fetchEpisodePage } from '~/functions/public'
import { publicPageHead } from '~/lib/page-meta'
import { jsonLdMeta, podcastEpisodeJsonLd } from '~/lib/structured-data'

// An episode's public page, at /podcasts/:slug/episodes/:episodeSlug. The
// trailing underscore on $slug_ keeps it from nesting inside the podcast page's
// route. Its owner manages it at .../manage; /listen has it without the site
// around it, for sharing.
export const Route = createFileRoute('/podcasts/$slug_/episodes/$episodeSlug')({
  staticData: { publicPage: true },
  loader: ({ params }) => fetchEpisodePage({ data: { slug: params.slug, episodeSlug: params.episodeSlug } }),
  head: ({ loaderData: page }) => {
    if (!page) return {}
    const head = publicPageHead(episodeHeadOptions(page))
    // Unlisted podcasts' episodes aren't described to search engines.
    if (page.podcast.private) return head
    const jsonLd = podcastEpisodeJsonLd({ ...page, image: page.previewImage?.url ?? null })
    return { ...head, meta: [...head.meta, jsonLdMeta(jsonLd)] }
  },
  component: EpisodePage,
})

function EpisodePage() {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <PublicEpisode page={Route.useLoaderData()} />
    </div>
  )
}
