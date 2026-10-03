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
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {podcasts.map((podcast) => (
                <SidebarMenuItem key={podcast.id}>
                  <SidebarMenuButton asChild className="h-10 gap-3 px-1.5">
                    <Link
                      to="/podcasts/$slug/manage"
                      params={{ slug: podcast.slug }}
                      // The attribute's presence is what styles it, so leave it off otherwise.
                      {...(isActive(podcast.slug) && { 'data-active': '' })}
                    >
                      {podcast.imageUrl ? (
                        <img
                          src={imageSrc(podcast.imageUrl, 28)}
                          alt=""
                          className="size-7 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Icons.logo className="size-4 text-muted-foreground" />
                        </span>
                      )}
                      <span className="truncate">{podcast.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
