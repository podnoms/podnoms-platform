import { createFileRoute, Link } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { PageSection } from '~/components/page-section'
import { PodcastGrid } from '~/components/podcast-card'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '~/components/ui/item'
import { fetchUserProfile } from '~/functions/public'
import { initials, pluralise } from '~/lib/format'
import { imageSrc } from '~/lib/images'
import { siteHead } from '~/lib/page-meta'
import { userPath } from '~/lib/paths'
import { htmlToText } from '~/lib/rich-text'
import { siteInfo } from '~/lib/site'
import { brandingFrom } from '~/lib/branding'

// A user's public profile, which anyone can see: who they are, and their
// public podcasts and playlists. @mentions in comments link here.
export const Route = createFileRoute('/u/$slug')({
  staticData: { publicPage: true },
  loader: ({ params }) => fetchUserProfile({ data: { slug: params.slug } }),
  head: ({ loaderData: profile, matches }) => {
    if (!profile) return {}
    const branding = brandingFrom(matches)
    const title = `${profile.name ?? `@${profile.slug}`} · ${branding.name}`
    const site = siteInfo(matches)
    if (!site?.origin) return { meta: [{ title }] }
    const about = profile.description ? htmlToText(profile.description).replace(/\s+/g, ' ').trim() : ''
    return siteHead({
      site: branding,
      origin: site.origin,
      path: userPath(profile.slug),
      title,
      description: about || `@${profile.slug} on ${branding.name}`,
    })
  },
  component: ProfilePage,
})

function ProfilePage() {
  const profile = Route.useLoaderData()
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar className="size-24">
          {profile.image && <AvatarImage src={imageSrc(profile.image, 192)} alt="" />}
          <AvatarFallback className="text-2xl">{initials(profile.name, null)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{profile.name ?? `@${profile.slug}`}</h1>
          {profile.name && <p className="text-muted-foreground">@{profile.slug}</p>}
        </div>
        {profile.isYou && (
          <Button variant="outline" asChild>
            <Link to="/settings">Edit profile</Link>
          </Button>
        )}
      </section>

      {profile.description && (
        // Sanitised on the server (see rich-text.server.ts).
        <div className="rich-text max-w-prose" dangerouslySetInnerHTML={{ __html: profile.description }} />
      )}

      {profile.podcasts.length > 0 && (
        <PageSection title="Podcasts">
          <PodcastGrid podcasts={profile.podcasts} />
        </PageSection>
      )}

      {profile.playlists.length > 0 && (
        <PageSection title="Playlists">
          <ItemGroup className="gap-2">
            {profile.playlists.map((playlist) => (
              <Item key={playlist.id} variant="outline" asChild>
                <Link to="/u/$slug/playlists/$playlistSlug" params={{ slug: profile.slug, playlistSlug: playlist.slug }}>
                  <ItemMedia variant="icon">
                    <Icons.playlist />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{playlist.title}</ItemTitle>
                    <ItemDescription>{pluralise(playlist.episodeCount, 'episode')}</ItemDescription>
                  </ItemContent>
                </Link>
              </Item>
            ))}
          </ItemGroup>
        </PageSection>
      )}
    </div>
  )
}
