import { useEffect, useState, type FormEvent } from 'react'
import { useLoaderData, useNavigate, useRouteContext, useSearch } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader } from '~/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { signUp } from '~/functions/auth'
import { signIn } from '~/lib/auth-client'
import { credentialsSchema } from '~/lib/auth-schema'

const oauthButtons = [
  ['github', 'GitHub', Icons.github],
  ['google', 'Google', Icons.google],
  ['facebook', 'Facebook', Icons.facebook],
] as const

// Error codes Auth.js reports after a failed sign-in.
const authErrors: Record<string, string> = {
  CredentialsSignin: 'Incorrect email or password.',
  OAuthAccountNotLinked: 'That email is already linked to a different sign-in method.',
  AccessDenied: 'Access was denied.',
}

// The page to return to after signing in: the current URL without the dialog's params.
function currentPageUrl() {
  const url = new URL(window.location.href)
  url.searchParams.delete('login')
  url.searchParams.delete('authError')
  return url.pathname + url.search
}

export function LoginDialog() {
  const { session } = useRouteContext({ from: '__root__' })
  const { providers } = useLoaderData({ from: '__root__' })
  const search = useSearch({ from: '__root__' })
  const navigate = useNavigate()
  const open = !session && Boolean(search.login)

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  // Reset the form each time the dialog opens, showing any error Auth.js sent back.
  useEffect(() => {
    if (!open) return
    setMode(search.login === 'signup' ? 'signUp' : 'signIn')
    setPending(false)
    setError(search.authError && (authErrors[search.authError] ?? 'Something went wrong signing you in.'))
  }, [open, search.login, search.authError])

  function close() {
    void navigate({
      to: '.',
      search: (prev) => ({ ...prev, login: undefined, authError: undefined }),
      replace: true,
    })
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = credentialsSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      if (mode === 'signUp') {
        const result = await signUp({ data: parsed.data })
        if (!result.ok) {
          setError(result.error)
          setPending(false)
          return
        }
      }
      // Navigates away on success, and back here with ?authError=… on failure.
      await signIn('credentials', { ...parsed.data, callbackUrl: currentPageUrl() })
    } catch {
      setError('Something went wrong. Please try again.')
      setPending(false)
    }
  }

  const isSignIn = mode === 'signIn'

  function toggleMode() {
    setError(undefined)
    setMode(isSignIn ? 'signUp' : 'signIn')
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {/* The dialog itself is a transparent frame holding the brand, the card
          and the terms, like a standalone login page.
          It doesn't auto-focus the first field: that sets off password
          managers the moment it opens. The dialog itself takes focus instead. */}
      <DialogContent
        showCloseButton={false}
        className="gap-6 bg-transparent p-0 ring-0 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).focus()
        }}
      >
        <div className="flex items-center justify-center gap-2 text-lg font-medium">
          <img src="/logo.png" alt="" className="size-8 rounded-md" />
          podnoms
        </div>
        <Card className="relative [--card-spacing:--spacing(6)]">
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3">
              <Icons.close />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
          <CardHeader className="text-center">
            <DialogTitle className="text-xl font-semibold">{isSignIn ? 'Welcome back' : 'Create an account'}</DialogTitle>
            <DialogDescription>
              {isSignIn ? 'Login' : 'Sign up'} with your GitHub, Google or Facebook account
            </DialogDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit}>
              <FieldGroup>
                <Field>
                  {oauthButtons.map(([id, label, Icon]) => (
                    <Button
                      key={id}
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={!providers[id] || pending}
                      onClick={() => signIn(id, { callbackUrl: currentPageUrl() })}
                    >
                      <Icon />
                      {isSignIn ? 'Login' : 'Sign up'} with {label}
                    </Button>
                  ))}
                </Field>
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                  Or continue with
                </FieldSeparator>
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="m@example.com"
                    autoComplete="email"
                    required
                    className="h-9"
                  />
                </Field>
                <Field>
                  <div className="flex items-center">
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    {isSignIn && (
                      // TODO: hook up a password reset flow.
                      <button type="button" className="ml-auto text-sm underline-offset-4 hover:underline">
                        Forgot your password?
                      </button>
                    )}
                  </div>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={isSignIn ? 'current-password' : 'new-password'}
                    required
                    className="h-9"
                  />
                </Field>
                {error && <FieldError>{error}</FieldError>}
                <Field>
                  <Button type="submit" size="lg" disabled={pending}>
                    {isSignIn ? 'Login' : 'Sign up'}
                  </Button>
                  <FieldDescription className="text-center">
                    {isSignIn ? "Don't have an account? " : 'Already have an account? '}
                    <button type="button" onClick={toggleMode} className="underline underline-offset-4">
                      {isSignIn ? 'Sign up' : 'Login'}
                    </button>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        {/* TODO: link to the real Terms of Service and Privacy Policy pages. */}
        <FieldDescription className="px-6 text-center">
          By clicking continue, you agree to our <a href="#">Terms of Service</a> and{' '}
          <a href="#">Privacy Policy</a>.
        </FieldDescription>
      </DialogContent>
    </Dialog>
  )
}
