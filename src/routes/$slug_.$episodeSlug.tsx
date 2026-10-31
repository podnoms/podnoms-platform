import { createFileRoute } from '@tanstack/react-router'
import { episodeHeadOptions, PublicEpisode } from '~/components/public-episode'
import { fetchEpisodePage } from '~/functions/public'
import { publicPageHead } from '~/lib/page-meta'
import { jsonLdMeta, showEpisodeJsonLd } from '~/lib/structured-data'
import { brandingFrom } from '~/lib/branding'

// An episode's public page, at /:slug/:episodeSlug. The
// trailing underscore on $slug_ keeps it from nesting inside the show page's
// route. Its owner manages it at .../manage; its share page (/s/<shortSlug>)
// has it without the site around it, for sharing.
export const Route = createFileRoute('/$slug_/$episodeSlug')({
  staticData: { publicPage: true },
  loader: ({ params }) => fetchEpisodePage({ data: { slug: params.slug, episodeSlug: params.episodeSlug } }),
  head: ({ loaderData: page, matches }) => {
    if (!page) return {}
    const branding = brandingFrom(matches)
    const head = publicPageHead({ ...episodeHeadOptions(page), site: branding })
    // Unlisted shows' episodes aren't described to search engines.
    if (page.show.private) return head
    const jsonLd = showEpisodeJsonLd({ ...page, siteName: branding.name, image: page.previewImage?.url ?? null })
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
