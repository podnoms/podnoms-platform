import { Link } from '@tanstack/react-router'
import { ModeToggle } from '~/components/mode-toggle'
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
    <header>
      <NavigationMenu viewport={false}>
        <NavigationMenuList>
          <NavigationMenuItem>
            <SidebarTrigger />
          </NavigationMenuItem>
          {navLinks.map(([to, label]) => (
            <NavigationMenuItem key={to}>
              <NavigationMenuLink asChild>
                <Link to={to} activeProps={{ 'data-active': '' }} activeOptions={{ exact: true }}>
                  {label}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          ))}
          <NavigationMenuItem>
            <ModeToggle />
          </NavigationMenuItem>
          <NavigationMenuItem>
            <UserMenu />
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </header>
  )
}
