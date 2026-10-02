import { useEffect, useState, type FormEvent } from 'react'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { startAuthentication } from '@simplewebauthn/browser'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader } from '~/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '~/components/ui/input-otp'
import { beginSecurityKeyChallenge, verifyTwoFactor } from '~/functions/two-factor'
import { signOut, updateSession } from '~/lib/auth-client'
import { recoveryCodeSchema, totpCodeSchema } from '~/lib/two-factor-schema'

type Factor = Parameters<typeof verifyTwoFactor>[0]['data']

// Asks for a second factor after signing in, for users with two-factor
// authentication on. It can't be dismissed: the way out is signing out.
export function TwoFactorDialog() {
  const { twoFactor } = useRouteContext({ from: '__root__' })
  const router = useRouter()
  const open = Boolean(twoFactor)

  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open) return
    setMode('totp')
    setCode('')
    setPending(false)
    setError(undefined)
  }, [open])

  async function submit(factor: Factor) {
    setError(undefined)
    setPending(true)
    try {
      const result = await verifyTwoFactor({ data: factor })
      if (!result.ok) {
        setError(result.error)
        setCode('')
        setPending(false)
        return
      }
      await updateSession({ twoFactorTicket: result.ticket })
      // Reloads the session and the signed-in user's data, closing this dialog.
      await router.invalidate()
    } catch {
      setError('Something went wrong. Please try again.')
      setPending(false)
    }
  }

  function submitCode(value: string) {
    const parsed = (mode === 'totp' ? totpCodeSchema : recoveryCodeSchema).safeParse(value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    void submit({ method: mode, code: parsed.data })
  }

  async function signInWithSecurityKey() {
    setError(undefined)
    setPending(true)
    try {
      const optionsJSON = await beginSecurityKeyChallenge()
      const response = await startAuthentication({ optionsJSON })
      await submit({ method: 'securityKey', response })
    } catch {
      // Includes the user cancelling the browser's prompt.
      setError("Your security key wasn't used. Please try again.")
      setPending(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submitCode(code)
  }

  const showCodeForm = mode === 'recovery' || twoFactor?.totp

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="gap-6 bg-transparent p-0 ring-0 sm:max-w-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-center gap-2 text-lg font-medium">
          <img src="/logo.png" alt="" className="size-8 rounded-md" />
          podnoms
        </div>
        <Card className="[--card-spacing:--spacing(6)]">
          <CardHeader className="text-center">
            <DialogTitle className="text-xl font-semibold">Two-factor authentication</DialogTitle>
            <DialogDescription>
              {mode === 'recovery'
                ? 'Enter one of the recovery codes you saved when you turned on two-factor authentication.'
                : twoFactor?.totp
                  ? 'Enter the code from your authenticator app to finish signing in.'
                  : 'Use your security key to finish signing in.'}
            </DialogDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit}>
              <FieldGroup>
                {showCodeForm &&
                  (mode === 'totp' ? (
                    <Field className="items-center">
                      <FieldLabel htmlFor="two-factor-code" className="sr-only">
                        Authentication code
                      </FieldLabel>
                      <InputOTP
                        id="two-factor-code"
                        maxLength={6}
                        pattern={REGEXP_ONLY_DIGITS}
                        autoComplete="one-time-code"
                        autoFocus
                        value={code}
                        onChange={setCode}
                        onComplete={submitCode}
                        disabled={pending}
                      >
                        <InputOTPGroup>
                          {[0, 1, 2, 3, 4, 5].map((index) => (
                            <InputOTPSlot key={index} index={index} className="size-10 text-base" />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="recovery-code">Recovery code</FieldLabel>
                      <Input
                        id="recovery-code"
                        autoComplete="off"
                        autoFocus
                        placeholder="abcde-fgh23"
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        className="h-9 font-mono"
                      />
                    </Field>
                  ))}
                {error && <FieldError className="text-center">{error}</FieldError>}
                {showCodeForm && (
                  <Field>
                    <Button type="submit" size="lg" disabled={pending}>
                      Verify
                    </Button>
                  </Field>
                )}
                {twoFactor?.securityKey && mode === 'totp' && (
                  <>
                    {twoFactor.totp && (
                      <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">Or</FieldSeparator>
                    )}
                    <Field>
                      <Button
                        type="button"
                        size="lg"
                        variant={twoFactor.totp ? 'outline' : 'default'}
                        disabled={pending}
                        onClick={signInWithSecurityKey}
                      >
                        <Icons.securityKey />
                        Use a security key
                      </Button>
                    </Field>
                  </>
                )}
                <FieldDescription className="text-center">
                  <button
                    type="button"
                    className="underline underline-offset-4"
                    onClick={() => {
                      setMode(mode === 'totp' ? 'recovery' : 'totp')
                      setCode('')
                      setError(undefined)
                    }}
                  >
                    {mode === 'totp' ? 'Use a recovery code' : 'Back'}
                  </button>
                  {' · '}
                  <button type="button" className="underline underline-offset-4" onClick={() => signOut()}>
                    Sign out
                  </button>
                </FieldDescription>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  )
}
