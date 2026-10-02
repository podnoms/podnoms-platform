import { useState, type FormEvent, type ReactNode } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { Icons } from '~/components/icons'
import { RecoveryCodesDialog } from '~/components/recovery-codes-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '~/components/ui/input-otp'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '~/components/ui/item'
import {
  beginSecurityKeySetup,
  beginTotpSetup,
  deleteSecurityKey,
  fetchTwoFactorStatus,
  finishSecurityKeySetup,
  finishTotpSetup,
  newRecoveryCodes,
  removeTotp,
} from '~/functions/two-factor'
import { formatDate } from '~/lib/format'
import { securityKeyNameSchema, totpCodeSchema } from '~/lib/two-factor-schema'

export const Route = createFileRoute('/_authed/security')({
  loader: () => fetchTwoFactorStatus(),
  head: () => ({ meta: [{ title: 'Security · podnoms' }] }),
  component: SecurityPage,
})

type Status = ReturnType<typeof Route.useLoaderData>

function SecurityPage() {
  const status = Route.useLoaderData()
  const router = useRouter()
  // Recovery codes to show, after turning 2FA on or making new ones.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)

  const reload = () => router.invalidate({ filter: (match) => match.routeId === Route.id })

  async function added(codes: string[] | null) {
    await reload()
    if (codes) setRecoveryCodes(codes)
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          Two-factor authentication
          <Badge variant={status.enabled ? 'default' : 'secondary'}>{status.enabled ? 'On' : 'Off'}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          After you sign in with your password or GitHub, Google or Facebook account, you'll also be asked for a
          code from your authenticator app or a tap of your security key.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icons.authenticatorApp className="size-4" />
            Authenticator app
          </CardTitle>
          <CardDescription>Codes from an app such as 1Password, Google Authenticator or Authy.</CardDescription>
          <CardAction>
            {status.totp ? (
              <ConfirmRemove
                title="Remove authenticator app?"
                lastFactor={status.securityKeys.length === 0}
                onConfirm={async () => {
                  await removeTotp()
                  await reload()
                }}
              >
                <Button variant="outline" size="sm">
                  Remove
                </Button>
              </ConfirmRemove>
            ) : (
              <TotpSetupDialog onAdded={added}>
                <Button size="sm">Set up</Button>
              </TotpSetupDialog>
            )}
          </CardAction>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icons.securityKey className="size-4" />
            Security keys
          </CardTitle>
          <CardDescription>Hardware keys such as a YubiKey, which you tap to sign in.</CardDescription>
          <CardAction>
            <SecurityKeyDialog onAdded={added}>
              <Button size="sm" variant={status.securityKeys.length ? 'outline' : 'default'}>
                <Icons.add />
                Add key
              </Button>
            </SecurityKeyDialog>
          </CardAction>
        </CardHeader>
        {status.securityKeys.length > 0 && (
          <CardContent>
            <ItemGroup>
              {status.securityKeys.map((key) => (
                <Item key={key.id} variant="outline" size="sm">
                  <ItemMedia variant="icon">
                    <Icons.securityKey />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{key.name}</ItemTitle>
                    <ItemDescription>
                      Added {formatDate(key.createdAt)}
                      {key.lastUsedAt ? ` · last used ${formatDate(key.lastUsedAt)}` : ''}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ConfirmRemove
                      title={`Remove “${key.name}”?`}
                      lastFactor={!status.totp && status.securityKeys.length === 1}
                      onConfirm={async () => {
                        await deleteSecurityKey({ data: { id: key.id } })
                        await reload()
                      }}
                    >
                      <Button variant="ghost" size="icon-sm">
                        <Icons.delete />
                        <span className="sr-only">Remove {key.name}</span>
                      </Button>
                    </ConfirmRemove>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        )}
      </Card>

      {status.enabled && <RecoveryCodesCard status={status} onRegenerated={added} />}

      <RecoveryCodesDialog codes={recoveryCodes} onClose={() => setRecoveryCodes(null)} />
    </div>
  )
}

function RecoveryCodesCard({ status, onRegenerated }: { status: Status; onRegenerated: (codes: string[]) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery codes</CardTitle>
        <CardDescription>
          {status.recoveryCodesLeft === 0
            ? "You've used all your recovery codes. Make new ones so you can still sign in if you lose your other factors."
            : `${status.recoveryCodesLeft} unused. Each one lets you sign in once without your app or key.`}
        </CardDescription>
        <CardAction>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Icons.retry />
                New codes
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Make new recovery codes?</AlertDialogTitle>
                <AlertDialogDescription>Your current recovery codes will stop working.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={async () => onRegenerated(await newRecoveryCodes())}>
                  Make new codes
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardAction>
      </CardHeader>
    </Card>
  )
}

function ConfirmRemove({
  title,
  lastFactor,
  onConfirm,
  children,
}: {
  title: string
  lastFactor: boolean
  onConfirm: () => Promise<void>
  children: ReactNode
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {lastFactor
              ? 'This turns off two-factor authentication, and your recovery codes will stop working.'
              : "You won't be able to use it to sign in any more."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type Setup = Awaited<ReturnType<typeof beginTotpSetup>>

function TotpSetupDialog({
  onAdded,
  children,
}: {
  onAdded: (recoveryCodes: string[] | null) => Promise<void>
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [setup, setSetup] = useState<Setup>()
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setSetup(undefined)
    setCode('')
    setError(undefined)
    try {
      setSetup(await beginTotpSetup())
    } catch {
      setError('Something went wrong. Please try again.')
    }
  }

  async function confirm(value: string) {
    const parsed = totpCodeSchema.safeParse(value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      const result = await finishTotpSetup({ data: { code: parsed.data } })
      if (!result.ok) {
        setError(result.error)
        setCode('')
        return
      }
      setOpen(false)
      await onAdded(result.recoveryCodes)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void confirm(code)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up an authenticator app</DialogTitle>
          <DialogDescription>
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </DialogDescription>
        </DialogHeader>
        <form id="totp-setup" onSubmit={onSubmit}>
          <FieldGroup>
            <div className="flex flex-col items-center gap-3">
              {setup ? (
                <img src={setup.qrCode} alt="QR code for your authenticator app" className="size-50 rounded-md" />
              ) : (
                <div className="size-50 animate-pulse rounded-md bg-muted" />
              )}
              {setup && (
                <FieldDescription className="text-center">
                  Can't scan it? Enter this key instead:
                  <br />
                  <code className="font-mono text-xs break-all text-foreground select-all">{setup.secret}</code>
                </FieldDescription>
              )}
            </div>
            <Field className="items-center">
              <FieldLabel htmlFor="totp-setup-code" className="sr-only">
                Code from your app
              </FieldLabel>
              <InputOTP
                id="totp-setup-code"
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                autoComplete="one-time-code"
                value={code}
                onChange={setCode}
                onComplete={confirm}
                disabled={!setup || pending}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot key={index} index={index} className="size-10 text-base" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </Field>
            {error && <FieldError className="text-center">{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" form="totp-setup" disabled={!setup || pending}>
            Turn on
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SecurityKeyDialog({
  onAdded,
  children,
}: {
  onAdded: (recoveryCodes: string[] | null) => Promise<void>
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const supported = typeof window === 'undefined' || browserSupportsWebAuthn()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = securityKeyNameSchema.safeParse(new FormData(event.currentTarget).get('name'))
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      const optionsJSON = await beginSecurityKeySetup()
      let response
      try {
        response = await startRegistration({ optionsJSON })
      } catch {
        // Includes the user cancelling the browser's prompt.
        setError("Your security key wasn't registered. Please try again.")
        return
      }
      const result = await finishSecurityKeySetup({ data: { name: parsed.data, response } })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      await onAdded(result.recoveryCodes)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setError(undefined)
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a security key</DialogTitle>
          <DialogDescription>
            Name your key, then insert it and tap it when your browser asks.
          </DialogDescription>
        </DialogHeader>
        <form id="security-key" onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="security-key-name">Name</FieldLabel>
              <Input
                id="security-key-name"
                name="name"
                placeholder="YubiKey 5C"
                autoComplete="off"
                required
                maxLength={60}
              />
            </Field>
            {!supported && <FieldError>This browser doesn't support security keys.</FieldError>}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" form="security-key" disabled={!supported || pending}>
            Add key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
