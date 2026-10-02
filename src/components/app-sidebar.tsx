import { Link, useLoaderData } from '@tanstack/react-router'
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
            <SidebarMenu>
              {podcasts.map((podcast) => (
                <SidebarMenuItem key={podcast.id}>
                  <SidebarMenuButton asChild>
                    <Link
                      to="/podcasts/$slug"
                      params={{ slug: podcast.slug }}
                      activeProps={{ 'data-active': '' }}
                    >
                      {podcast.imageUrl ? (
                        <img
                          src={imageSrc(podcast.imageUrl, 24)}
                          alt=""
                          className="size-6 shrink-0 rounded-sm object-cover"
                        />
                      ) : (
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-muted">
                          <Icons.logo className="size-3.5 text-muted-foreground" />
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
