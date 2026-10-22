import { Link } from '@tanstack/react-router'
import { DiscordLink } from '~/components/discord-link'
import { DonateDialog } from '~/components/donate-dialog'
import { ModeToggle } from '~/components/mode-toggle'
import { NotificationsMenu } from '~/components/notifications-menu'
import { SearchCommand } from '~/components/search-command'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '~/components/ui/navigation-menu'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { useSidebar } from '~/components/ui/sidebar'
import { UserMenu } from '~/components/user-menu'
import { navLinks } from '~/lib/nav-links'

export function TopNav() {
  return (
    <header className="sticky top-0 z-10 flex h-(--top-nav-height) shrink-0 items-center gap-2 bg-background px-4">
      <MenuButton />
      <NavigationMenu viewport={false}>
        <NavigationMenuList>
          {navLinks.map(([to, label]) => (
            <NavigationMenuItem key={to}>
              <NavigationMenuLink asChild>
                <Link to={to} activeProps={{ 'data-active': '' }} activeOptions={{ exact: true }}>
                  {label}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          ))}
        </NavigationMenuList>
      </NavigationMenu>
      <div className="ml-auto flex items-center gap-1">
        <DonateDialog />
        <DiscordLink />
        <SearchCommand />
        <ModeToggle />
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  )
}

// Opens the sidebar on phones, where it's a sheet over the page (which covers
// this button while it's open). Hidden by CSS rather than `isMobile`, which is
// only known after hydration; md matches the sidebar's own breakpoint.
function MenuButton() {
  const { setOpenMobile } = useSidebar()
  return (
    <Button variant="ghost" size="icon-sm" className="-ml-1 md:hidden" onClick={() => setOpenMobile(true)}>
      <Icons.menu />
      <span className="sr-only">Open menu</span>
    </Button>
  )
}
