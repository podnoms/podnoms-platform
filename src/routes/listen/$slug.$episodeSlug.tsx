import { createFileRoute } from '@tanstack/react-router'
import { PlayerProvider } from '~/components/player/player-provider'
import { episodeHeadOptions, PublicEpisode } from '~/components/public-episode'
import { fetchEpisodePage } from '~/functions/public'
import { publicPageHead } from '~/lib/page-meta'

// An episode on its own, for sharing: the episode page without the site's
// header, sidebar or player bar. It brings its own player, as the shell isn't
// there to provide one. Link previews describe the episode as the episode page
// does, and search engines are pointed there.
export const Route = createFileRoute('/listen/$slug/$episodeSlug')({
  staticData: { bare: true },
  loader: ({ params }) => fetchEpisodePage({ data: { slug: params.slug, episodeSlug: params.episodeSlug } }),
  head: ({ loaderData: page }) => (page ? publicPageHead({ ...episodeHeadOptions(page), shareUrl: page.shareUrl }) : {}),
  component: ListenPage,
})

function ListenPage() {
  const { session } = Route.useRouteContext()
  return (
    <PlayerProvider signedIn={Boolean(session)}>
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center gap-8 p-4 md:p-8">
        <PublicEpisode page={Route.useLoaderData()} standalone />
        <a href="/" className="flex w-fit items-center gap-2 self-center text-sm text-muted-foreground hover:text-foreground">
          with ❤️ from podnoms
        </a>
      </main>
    </PlayerProvider>
  )
}
