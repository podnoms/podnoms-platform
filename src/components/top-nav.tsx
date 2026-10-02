import { Link } from '@tanstack/react-router'
import { ModeToggle } from '~/components/mode-toggle'
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '~/components/ui/navigation-menu'
import { Separator } from '~/components/ui/separator'
import { SidebarTrigger } from '~/components/ui/sidebar'
import { UserMenu } from '~/components/user-menu'
import { navLinks } from '~/lib/nav-links'

export function TopNav() {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 bg-background px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
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
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
