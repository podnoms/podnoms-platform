import { Link } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { ModeToggle } from '~/components/mode-toggle'
import { Button } from '~/components/ui/button'
import { UserMenu } from '~/components/user-menu'

// Header for signed-out visitors, in place of the sidebar and top nav.
export function PublicHeader() {
  return (
    <header className="flex items-center gap-2 border-b px-4 py-3">
      <Link to="/" className="flex items-center gap-2 font-medium">
        <img src="/logo.png" alt="" className="size-7 rounded-md" />
        podnoms
      </Link>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" asChild>
          <Link to="/explore" activeProps={{ 'data-active': '' }} className="data-active:bg-accent">
            <Icons.explore />
            Explore
          </Link>
        </Button>
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
