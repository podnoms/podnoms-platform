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
import { imageSrc } from '~/lib/images'

// Up to two initials from the name, else the first letter of the email.
function initials(name: string | null | undefined, email: string | null | undefined) {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (words.length) return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (email?.[0] ?? '?').toUpperCase()
}

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

  const { name, email, image } = session.user

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
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()}>
          <Icons.signOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
