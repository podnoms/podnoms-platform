import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '~/components/ui/field'
import { Switch } from '~/components/ui/switch'
import { fetchListeningHistoryPref, saveListeningHistoryPref } from '~/functions/profile'
import { pageTitle, useBranding } from '~/lib/branding'

export const Route = createFileRoute('/_authed/settings/privacy')({
  loader: () => fetchListeningHistoryPref(),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Privacy · Settings') }] }),
  component: PrivacyPage,
})

// Whether what the user plays, downloads and shares is kept against their
// account (see listening-history.server.ts).
function PrivacyPage() {
  const { keep, keepDays } = Route.useLoaderData()
  const { name } = useBranding()
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function save(value: boolean) {
    setError(undefined)
    setPending(true)
    try {
      await saveListeningHistoryPref({ data: { keep: value } })
      await router.invalidate({ filter: (match) => match.routeId === Route.id })
    } catch {
      setError('Something went wrong saving that. Please try again.')
    } finally {
      setPending(false)
      setConfirming(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Listening history</CardTitle>
        <CardDescription>
          Show owners only ever see anonymous totals, never who listened. See the{' '}
          <Link to="/privacy" className="underline underline-offset-4">
            privacy policy
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="keep-listening-history">Keep my listening history</FieldLabel>
            <FieldDescription>
              While you're signed in, the episodes you play, download and share are recorded against your account, so
              {` ${name}`}'s admins can see how the site is used. It's kept for {keepDays} days. Turning this off
              deletes what's been kept and stops recording it.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="keep-listening-history"
            checked={keep}
            disabled={pending}
            onCheckedChange={(value) => (value ? void save(true) : setConfirming(true))}
          />
        </Field>
        {error && <FieldError>{error}</FieldError>}
      </CardContent>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off your listening history?</AlertDialogTitle>
            <AlertDialogDescription>
              What's been kept of what you've played, downloaded and shared is deleted now, and nothing more is
              recorded until you turn it back on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                void save(false)
              }}
            >
              Turn off and delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
