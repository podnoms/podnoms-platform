import { Link, useRouteContext } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { signOut } from '~/lib/auth-client'

export function UserMenu() {
  const { session } = useRouteContext({ from: '__root__' })

  if (!session) {
    return (
      <Button variant="ghost" asChild>
        <Link to="." search={(prev) => ({ ...prev, login: true })}>
          Sign in
        </Link>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">{session.user.name ?? session.user.email}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {session.user.name && session.user.email && (
          <>
            <DropdownMenuLabel className="font-normal text-muted-foreground">{session.user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <Link to="/security">
            <Icons.security />
            Security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut()}>
          <Icons.signOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
