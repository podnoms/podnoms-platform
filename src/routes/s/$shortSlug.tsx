import { createFileRoute, redirect } from '@tanstack/react-router'
import { PlayerProvider } from '~/components/player/player-provider'
import { episodeHeadOptions, PublicEpisode } from '~/components/public-episode'
import { fetchSharePage } from '~/functions/public'
import { publicPageHead } from '~/lib/page-meta'

// An episode on its own, for sharing, at its short link: the episode page
// without the site's header, sidebar or player bar. It brings its own player,
// as the shell isn't there to provide one. Link previews describe the episode
// as the episode page does, and search engines are pointed there.
export const Route = createFileRoute('/s/$shortSlug')({
  staticData: { bare: true },
  // Short links are lower case; one typed in capitals still works.
  beforeLoad: ({ params }) => {
    const shortSlug = params.shortSlug.toLowerCase()
    if (shortSlug !== params.shortSlug) throw redirect({ to: '/s/$shortSlug', params: { shortSlug }, statusCode: 301 })
  },
  loader: ({ params }) => fetchSharePage({ data: { shortSlug: params.shortSlug } }),
  head: ({ loaderData: page }) => (page ? publicPageHead({ ...episodeHeadOptions(page), shareUrl: page.shareUrl }) : {}),
  component: SharePage,
})

function SharePage() {
  const { session } = Route.useRouteContext()
  return (
    <PlayerProvider signedIn={Boolean(session)} source="listen">
      <div className="flex min-h-dvh flex-col">
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center p-4 md:p-8">
          <PublicEpisode page={Route.useLoaderData()} standalone />
        </main>
        <footer className="flex justify-center p-4">
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
            with ❤️ from podnoms
          </a>
        </footer>
      </div>
    </PlayerProvider>
  )
}
