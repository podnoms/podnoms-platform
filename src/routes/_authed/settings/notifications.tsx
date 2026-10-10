import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Switch } from '~/components/ui/switch'
import { fetchNotificationPrefs, saveNotificationPrefs } from '~/functions/profile'

export const Route = createFileRoute('/_authed/settings/notifications')({
  loader: () => fetchNotificationPrefs(),
  head: () => ({ meta: [{ title: 'Notifications · Settings · podnoms' }] }),
  component: NotificationsPage,
})

type Pref = 'notifyEpisodeFailed' | 'notifyNewEpisodes'

const options: { pref: Pref; label: string; description: string }[] = [
  {
    pref: 'notifyEpisodeFailed',
    label: 'Episodes that fail',
    description: "When an episode can't be downloaded or converted, so you can retry it or upload it again.",
  },
  {
    pref: 'notifyNewEpisodes',
    label: 'New episodes from channels',
    description: 'When a podcast that follows a YouTube channel or Mixcloud account picks up new uploads.',
  },
]

// Which emails the user gets about their podcasts. Emails are batched: a few
// minutes' events come in one email.
function NotificationsPage() {
  const prefs = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string>()

  async function toggle(pref: Pref, value: boolean) {
    setError(undefined)
    try {
      await saveNotificationPrefs({
        data: { notifyEpisodeFailed: prefs.notifyEpisodeFailed, notifyNewEpisodes: prefs.notifyNewEpisodes, [pref]: value },
      })
      await router.invalidate({ filter: (match) => match.routeId === Route.id })
    } catch {
      setError('Something went wrong saving that. Please try again.')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {!prefs.emailEnabled && (
        <Alert>
          <AlertTitle>Email isn't set up on this site</AlertTitle>
          <AlertDescription>
            Your choices are saved, but no emails are sent until the site's admin sets up email.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Email me about</CardTitle>
          <CardDescription>
            Sent to your account's email address. A few minutes' worth come together in one email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {options.map(({ pref, label, description }) => (
              <Field key={pref} orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor={pref}>{label}</FieldLabel>
                  <FieldDescription>{description}</FieldDescription>
                </FieldContent>
                <Switch id={pref} checked={prefs[pref]} onCheckedChange={(value) => void toggle(pref, value)} />
              </Field>
            ))}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}
