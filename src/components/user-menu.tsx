import { Link, useRouteContext } from '@tanstack/react-router'
import { Button } from '~/components/ui/button'
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
    <Button variant="ghost" onClick={() => signOut()}>
      Sign out ({session.user.name ?? session.user.email})
    </Button>
  )
}
