import { useEffect, useRef, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { LoginDialog } from '~/components/login-dialog'
import { PlayerProvider } from '~/components/player/player-provider'
import { episodeHeadOptions, PublicEpisode } from '~/components/public-episode'
import { TwoFactorDialog } from '~/components/two-factor-dialog'
import { fetchSharePage } from '~/functions/public'
import { reportTrackedLinkVisit } from '~/lib/activity'
import { publicPageHead } from '~/lib/page-meta'
import { brandingFrom, useBranding } from '~/lib/branding'

// An episode on its own, for sharing, at its short link: the episode page
// without the site's header, sidebar or player bar. It brings its own player,
// as the shell isn't there to provide one. Link previews describe the episode
// as the episode page does, and search engines are pointed there. With `t`,
// it was opened through a tracked link (see tracked-links.server.ts).
export const Route = createFileRoute('/s/$shortSlug')({
  staticData: { bare: true },
  validateSearch: z.object({ t: z.string().max(64).optional() }),
  // Short links are lower case; one typed in capitals still works.
  beforeLoad: ({ params }) => {
    const shortSlug = params.shortSlug.toLowerCase()
    if (shortSlug !== params.shortSlug) throw redirect({ to: '/s/$shortSlug', params: { shortSlug }, statusCode: 301 })
  },
  loader: ({ params }) => fetchSharePage({ data: { shortSlug: params.shortSlug } }),
  head: ({ loaderData: page, matches }) =>
    page ? publicPageHead({ ...episodeHeadOptions(page), site: brandingFrom(matches), shareUrl: page.shareUrl }) : {},
  component: SharePage,
})

function SharePage() {
  const { session } = Route.useRouteContext()
  const page = Route.useLoaderData()
  const trackedLink = useTrackedLink(page.episode.id)
  const branding = useBranding()
  return (
    <PlayerProvider signedIn={Boolean(session)} source="listen" trackedLink={trackedLink}>
      <div className="flex min-h-dvh flex-col">
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center p-4 md:p-8">
          <PublicEpisode page={page} standalone />
        </main>
        <footer className="flex justify-center p-4">
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
            with ❤️ from {branding.name}
          </a>
        </footer>
      </div>
      {/* For the Like button: signing in happens here, without leaving the episode. */}
      <LoginDialog />
      <TwoFactorDialog />
    </PlayerProvider>
  )
}

// The tracked link the page was opened through, if any. The open is reported
// from here rather than the server, so link previews (which don't run
// scripts) don't count. The token is then taken out of the address, so
// reloading doesn't count again, and a link copied from the address bar and
// passed on isn't put down to the person it was made for.
function useTrackedLink(episodeId: string) {
  const { t } = Route.useSearch()
  const navigate = useNavigate()
  const [trackedLink] = useState(() => (t ? { token: t, episodeId } : null))
  const reported = useRef(false)
  useEffect(() => {
    if (!trackedLink || reported.current) return
    reported.current = true
    reportTrackedLinkVisit(trackedLink.token, { type: 'open', episodeId: trackedLink.episodeId })
    void navigate({ to: '.', search: {}, replace: true })
  }, [trackedLink, navigate])
  return trackedLink
}
