import { useState } from 'react'
import { Link, useLoaderData, useLocation } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { NewPodcastDialog } from '~/components/new-podcast-dialog'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '~/components/ui/sidebar'
import { imageSrc } from '~/lib/images'
import { navLinks } from '~/lib/nav-links'

export function AppSidebar() {
  const { podcasts } = useLoaderData({ from: '__root__' })
  const pathname = useLocation({ select: (location) => location.pathname })
  // A podcast's public and management pages, and its episodes', all count as its.
  const isActive = (slug: string) => pathname === `/podcasts/${slug}` || pathname.startsWith(`/podcasts/${slug}/`)
  // A long list gets a filter box.
  const filterable = podcasts.length > 8
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = filterable && needle ? podcasts.filter((p) => p.title.toLowerCase().includes(needle)) : podcasts

  return (
    // Ends above the player bar rather than running behind it, with no border
    // between it and the page.
    <Sidebar className="bottom-(--player-height) h-auto group-data-[side=left]:border-r-0">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/" className="font-medium">
                <img src="/logo.png" alt="" className="size-7 rounded-md" />
                <div className="grid flex-1 text-start text-sm leading-tight">
                  <span className="truncate font-semibold">Pod:Noms</span>
                  <span className="truncate text-xs">Robot powered podcasts</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Podcasts</SidebarGroupLabel>
          <NewPodcastDialog>
            <SidebarGroupAction title="New podcast">
              <Icons.add />
              <span className="sr-only">New podcast</span>
            </SidebarGroupAction>
          </NewPodcastDialog>
          <SidebarGroupContent className="flex flex-col gap-2">
            {filterable && (
              <SidebarInput
                type="search"
                placeholder="Filter podcasts"
                aria-label="Filter podcasts"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
              />
            )}
            <SidebarMenu className="gap-1">
              {shown.map((podcast) => (
                <SidebarMenuItem key={podcast.id}>
                  <SidebarMenuButton asChild className="h-12 gap-3 px-2">
                    <Link
                      to="/podcasts/$slug/manage"
                      params={{ slug: podcast.slug }}
                      // The attribute's presence is what styles it, so leave it off otherwise.
                      {...(isActive(podcast.slug) && { 'data-active': '' })}
                    >
                      {podcast.imageUrl ? (
                        <img
                          src={imageSrc(podcast.imageUrl, 32)}
                          alt=""
                          className="size-8 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Icons.logo className="size-4 text-muted-foreground" />
                        </span>
                      )}
                      <span className="truncate">{podcast.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {shown.length === 0 && podcasts.length > 0 && (
                <SidebarMenuItem>
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">No podcasts match</p>
                </SidebarMenuItem>
              )}
              {podcasts.length === 0 && (
                <SidebarMenuItem>
                  <NewPodcastDialog>
                    <SidebarMenuButton>
                      <Icons.add />
                      New podcast
                    </SidebarMenuButton>
                  </NewPodcastDialog>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
