import { useState } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '~/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { signOut } from '~/lib/auth-client'
import { brandLogoUrl, useBranding } from '~/lib/branding'

// Shown to a user whose account an admin has put on hold (see setUserOnHold in
// admin.server.ts), with the admin's reason. Their session counts as signed
// out, so this is all they get; it can't be dismissed, and the way out is
// signing out.
export function AccountOnHoldDialog() {
  const { accountOnHold } = useRouteContext({ from: '__root__' })
  const branding = useBranding()
  const [pending, setPending] = useState(false)

  return (
    <Dialog open={Boolean(accountOnHold)}>
      <DialogContent
        showCloseButton={false}
        className="gap-6 bg-transparent p-0 ring-0 sm:max-w-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-center gap-2 text-lg font-medium">
          <img src={brandLogoUrl(branding)} alt="" className="size-8 rounded-md" />
          {branding.name}
        </div>
        <Card className="[--card-spacing:--spacing(6)]">
          <CardHeader className="text-center">
            <DialogTitle className="text-xl font-semibold">Your account is on hold</DialogTitle>
            <DialogDescription>You can't use your account until it's taken off hold.</DialogDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="rounded-md bg-muted p-4 whitespace-pre-wrap break-words">{accountOnHold?.reason}</p>
            {branding.contactEmail && (
              <p className="text-center text-muted-foreground">
                Questions? Contact us at{' '}
                <a href={`mailto:${branding.contactEmail}`} className="underline underline-offset-4">
                  {branding.contactEmail}
                </a>
                .
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              disabled={pending}
              onClick={() => {
                setPending(true)
                void signOut()
              }}
            >
              Sign out
            </Button>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  )
}
