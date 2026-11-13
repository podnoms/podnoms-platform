import { createFileRoute } from '@tanstack/react-router'
import { episodeHeadOptions, PublicEpisode } from '~/components/public-episode'
import { fetchEpisodePage } from '~/functions/public'
import { publicPageHead } from '~/lib/page-meta'
import { showThemeHead } from '~/lib/app-shell'
import { jsonLdMeta, showEpisodeJsonLd } from '~/lib/structured-data'
import { brandingFrom } from '~/lib/branding'

// An episode's public page, at /<owner>/<show>/<episode>. The trailing
// underscores keep it from nesting inside the profile's and show page's
// routes. Its owner manages it at .../manage; its share page (/s/<shortSlug>)
// has it without the site around it, for sharing.
export const Route = createFileRoute('/$user_/$show_/$episode')({
  staticData: { publicPage: true },
  loader: ({ params }) => fetchEpisodePage({ data: params }),
  head: ({ loaderData: page, matches }) => {
    if (!page) return {}
    const branding = brandingFrom(matches)
    const head = publicPageHead({ ...episodeHeadOptions(page), site: branding })
    const theme = showThemeHead(matches, page.theme)
    const themed = { ...head, links: [...head.links, ...theme.links], styles: theme.styles }
    // Unlisted shows' episodes aren't described to search engines.
    if (page.show.private) return themed
    const jsonLd = showEpisodeJsonLd({ ...page, siteName: branding.name, image: page.previewImage?.url ?? null })
    return { ...themed, meta: [...head.meta, jsonLdMeta(jsonLd)] }
  },
  component: EpisodePage,
})

function EpisodePage() {
  return (
    <div className="mx-auto w-full max-w-page p-4 md:p-6">
      <PublicEpisode page={Route.useLoaderData()} />
    </div>
  )
}
