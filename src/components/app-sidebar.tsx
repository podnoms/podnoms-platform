import { useMemo, useState, type MouseEvent } from 'react'
import { Link, useLoaderData, useLocation } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { NewShowDialog } from '~/components/new-show-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
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
  useSidebar,
} from '~/components/ui/sidebar'
import { imageSrc } from '~/lib/images'
import { cn } from '~/lib/utils'
import { showSorts, saveShowSort, sortShows, type ShowSort } from '~/lib/show-sort'
import { brandLogoUrl, useBranding } from '~/lib/branding'

// The sidebar lists this many followed shows, and links to the Following
// page for the rest.
const maxFollowedShown = 8

// Links to the listener's pages, for everyone, whether they make shows or not.
const libraryLinks = [
  { to: '/explore', label: 'Explore', icon: Icons.explore },
  { to: '/likes', label: 'Likes', icon: Icons.like },
  { to: '/following', label: 'Following', icon: Icons.following },
  { to: '/playlists', label: 'Playlists', icon: Icons.playlist },
] as const

export function AppSidebar() {
  const { shows: loaded, following, showSort } = useLoaderData({ from: '__root__' })
  const branding = useBranding()
  const [sort, setSort] = useState(showSort)
  const shows = useMemo(() => sortShows(loaded, sort), [loaded, sort])
  const pathname = useLocation({ select: (location) => location.pathname })
  // A show's public and management pages, and its episodes', all count as its.
  const isActive = (slug: string) => pathname === `/${slug}` || pathname.startsWith(`/${slug}/`)
  // A long list gets a filter box.
  const filterable = shows.length > 8
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = filterable && needle ? shows.filter((p) => p.title.toLowerCase().includes(needle)) : shows
  // On phones the sidebar is a sheet over the page, so following one of its
  // links closes it (even a link to the page already showing).
  const { isMobile, setOpenMobile } = useSidebar()
  const closeOnLink = (event: MouseEvent) => {
    if (isMobile && (event.target as HTMLElement).closest('a')) setOpenMobile(false)
  }

  return (
    // Ends above the player bar rather than running behind it, with no border
    // between it and the page.
    <Sidebar className="bottom-(--player-height) h-auto group-data-[side=left]:border-r-0">
      <SidebarHeader onClick={closeOnLink}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/" className="font-medium">
                <img src={brandLogoUrl(branding)} alt="" className="size-12 rounded-md" />
                <div className="grid flex-1 text-start text-sm leading-tight">
                  <span className="truncate font-semibold">{branding.name}</span>
                  <span className="truncate text-xs">{branding.tagline}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent onClick={closeOnLink}>
        <SidebarGroup>
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {libraryLinks.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild isActive={pathname === to}>
                    <Link to={to}>
                      <Icon />
                      {label}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {following.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Following</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {following.slice(0, maxFollowedShown).map((show) => (
                  <SidebarMenuItem key={show.id}>
                    <SidebarMenuButton asChild className="h-10 gap-3 px-2">
                      <Link to="/$slug" params={{ slug: show.slug }} {...(isActive(show.slug) && { 'data-active': '' })}>
                        <ShowThumb imageUrl={show.imageUrl} className="size-6" />
                        <span className="truncate">{show.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {following.length > maxFollowedShown && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild className="text-muted-foreground">
                      <Link to="/following">See all {following.length}</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup>
          <SidebarGroupLabel>Your shows</SidebarGroupLabel>
          {shows.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* Beside the "New show" action, which takes the usual place. */}
                <SidebarGroupAction title="Sort shows" className="right-9">
                  <Icons.sort />
                  <span className="sr-only">Sort shows: {showSorts[sort]}</span>
                </SidebarGroupAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(value) => {
                    setSort(value as ShowSort)
                    saveShowSort(value as ShowSort)
                  }}
                >
                  {Object.entries(showSorts).map(([value, label]) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <NewShowDialog>
            <SidebarGroupAction title="New show">
              <Icons.add />
              <span className="sr-only">New show</span>
            </SidebarGroupAction>
          </NewShowDialog>
          <SidebarGroupContent className="flex flex-col gap-2">
            {filterable && (
              <SidebarInput
                type="search"
                placeholder="Filter shows"
                aria-label="Filter shows"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
              />
            )}
            <SidebarMenu className="gap-1">
              {shown.map((show) => (
                <SidebarMenuItem key={show.id}>
                  <SidebarMenuButton asChild className="h-12 gap-3 px-2">
                    <Link
                      to="/$slug/manage"
                      params={{ slug: show.slug }}
                      // The attribute's presence is what styles it, so leave it off otherwise.
                      {...(isActive(show.slug) && { 'data-active': '' })}
                    >
                      <ShowThumb imageUrl={show.imageUrl} className="size-8" />
                      <span className="truncate">{show.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {shown.length === 0 && shows.length > 0 && (
                <SidebarMenuItem>
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">No shows match</p>
                </SidebarMenuItem>
              )}
              {shows.length === 0 && (
                <SidebarMenuItem>
                  <NewShowDialog>
                    <SidebarMenuButton className="text-muted-foreground">
                      <Icons.add />
                      Create a show
                    </SidebarMenuButton>
                  </NewShowDialog>
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

function ShowThumb({ imageUrl, className }: { imageUrl: string | null; className: string }) {
  return imageUrl ? (
    <img src={imageSrc(imageUrl, 32)} alt="" className={cn('shrink-0 rounded-md object-cover', className)} />
  ) : (
    <span className={cn('flex shrink-0 items-center justify-center rounded-md bg-muted', className)}>
      <Icons.logo className="size-4 text-muted-foreground" />
    </span>
  )
}
