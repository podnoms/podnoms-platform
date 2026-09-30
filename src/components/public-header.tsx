import { Link } from '@tanstack/react-router'
import { ModeToggle } from '~/components/mode-toggle'
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
        <ModeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
