import { Link, useRouteContext } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
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
import { initials } from '~/lib/format'
import { imageSrc } from '~/lib/images'

export function UserMenu() {
  const { session } = useRouteContext({ from: '__root__' })

  if (!session) {
    return (
      <Button size="sm" asChild>
        <Link to="." search={(prev) => ({ ...prev, login: true })}>
          Sign in
        </Link>
      </Button>
    )
  }

  const { name, email, image, isAdmin } = session.user

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar>
            {image && <AvatarImage src={imageSrc(image, 32)} alt="" />}
            <AvatarFallback>{initials(name, email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex flex-col font-normal">
          {name && <span className="font-medium text-foreground">{name}</span>}
          {email && <span className="text-muted-foreground">{email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Icons.settings />
            Settings
          </Link>
        </DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuItem asChild>
              <Link to="/admin">
                <Icons.security />
                Admin
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              {/* The job queue UI is a separate page, not one of the app's routes. */}
              <a href="/admin/queues">
                <Icons.jobs />
                Jobs
              </a>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()}>
          <Icons.signOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
