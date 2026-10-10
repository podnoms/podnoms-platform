import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { checkResetToken, resetPasswordFn } from '~/functions/auth'
import { resetPasswordSchema } from '~/lib/auth-schema'

// Where a password reset email's link goes: choose a new password.
export const Route = createFileRoute('/reset-password')({
  validateSearch: z.object({ token: z.string().max(200).optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => ({ valid: deps.token ? await checkResetToken({ data: { token: deps.token } }) : false }),
  head: () => ({ meta: [{ title: 'Reset your password · podnoms' }, { name: 'robots', content: 'noindex' }] }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token } = Route.useSearch()
  const { valid } = Route.useLoaderData()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = resetPasswordSchema.safeParse({ token, ...Object.fromEntries(new FormData(event.currentTarget)) })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      const result = await resetPasswordFn({ data: parsed.data })
      if (!result.ok) {
        setError(result.error)
        return
      }
      await navigate({ to: '/', search: { login: true, notice: 'passwordReset' } })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Choose a new password</CardTitle>
          <CardDescription>
            {valid ? 'Then sign in with it.' : 'This link has expired or has already been used.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {valid ? (
            <form onSubmit={onSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="new-password">New password</FieldLabel>
                  <Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
                  <FieldDescription>At least 8 characters.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
                  <Input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required />
                </Field>
                {error && <FieldError>{error}</FieldError>}
                <Button type="submit" disabled={pending}>
                  Change password
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Reset links work once, for an hour.{' '}
              <Link to="/" search={{ login: true }} className="underline underline-offset-4">
                Ask for a new one
              </Link>{' '}
              from the login dialog.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
