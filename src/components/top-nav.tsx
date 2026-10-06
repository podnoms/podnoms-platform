import { Link } from '@tanstack/react-router'
import { DiscordLink } from '~/components/discord-link'
import { DonateMenu } from '~/components/donate-menu'
import { ModeToggle } from '~/components/mode-toggle'
import { SearchCommand } from '~/components/search-command'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '~/components/ui/navigation-menu'
import { SidebarTrigger } from '~/components/ui/sidebar'
import { UserMenu } from '~/components/user-menu'
import { navLinks } from '~/lib/nav-links'

export function TopNav() {
  return (
    <header className="sticky top-0 z-10 flex h-(--top-nav-height) shrink-0 items-center gap-2 bg-background px-4">
      <SidebarTrigger className="-ml-1" />
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
        <DonateMenu />
        <DiscordLink />
        <SearchCommand />
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
