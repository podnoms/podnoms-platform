import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '~/components/ui/field'
import { Switch } from '~/components/ui/switch'
import { DesktopNotifications } from '~/components/desktop-notifications'
import { FollowedPodcastNotifications } from '~/components/followed-podcast-notifications'
import { fetchNotificationPrefs, saveNotificationPrefs } from '~/functions/profile'
import { fetchPushSettings } from '~/functions/push'

export const Route = createFileRoute('/_authed/settings/notifications')({
  loader: async () => {
    const [prefs, push] = await Promise.all([fetchNotificationPrefs(), fetchPushSettings()])
    return { ...prefs, push }
  },
  head: () => ({ meta: [{ title: 'Notifications · Settings · podnoms' }] }),
  component: NotificationsPage,
})

type Pref = 'notifyEpisodeFailed' | 'notifyNewEpisodes' | 'emailLive' | 'emailFollowedEpisodes' | 'emailMentions'
type Option = { pref: Pref; label: string; description: string }

const yourPodcasts: Option[] = [
  {
    pref: 'notifyEpisodeFailed',
    label: 'Episodes that fail',
    description: "When an episode can't be downloaded or converted, so you can retry it or upload it again.",
  },
  {
    pref: 'notifyNewEpisodes',
    label: 'New episodes from channels',
    description: 'When a podcast that follows a YouTube channel, or a Mixcloud or SoundCloud account, picks up new uploads.',
  },
]

const aboutYou: Option[] = [
  {
    pref: 'emailMentions',
    label: 'Mentions and replies',
    description: 'When someone @mentions you in a comment, or replies to yours.',
  },
]

// The same kinds as desktop notifications.
const followedPodcasts: Option[] = [
  { pref: 'emailLive', label: 'Going live', description: 'When a podcast you follow starts a live broadcast. Sent straight away.' },
  { pref: 'emailFollowedEpisodes', label: 'New episodes', description: 'When a podcast you follow has a new episode.' },
]

// Which emails the user gets about their podcasts and the ones they follow
// (batched: a few minutes' events come in one email), desktop notifications,
// and which of the podcasts they follow they hear about.
function NotificationsPage() {
  const prefs = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string>()

  const reload = () => router.invalidate({ filter: (match) => match.routeId === Route.id })

  async function toggle(pref: Pref, value: boolean) {
    setError(undefined)
    try {
      const { notifyEpisodeFailed, notifyNewEpisodes, emailLive, emailFollowedEpisodes, emailMentions } = prefs
      await saveNotificationPrefs({
        data: { notifyEpisodeFailed, notifyNewEpisodes, emailLive, emailFollowedEpisodes, emailMentions, [pref]: value },
      })
      await reload()
    } catch {
      setError('Something went wrong saving that. Please try again.')
    }
  }

  const switches = (legend: string, options: Option[]) => (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
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
      </FieldGroup>
    </FieldSet>
  )

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
            {switches('Your podcasts', yourPodcasts)}
            {switches('You', aboutYou)}
            {switches('Podcasts you follow', followedPodcasts)}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </CardContent>
      </Card>
      <DesktopNotifications settings={prefs.push} onChange={reload} />
      <FollowedPodcastNotifications follows={prefs.follows} onChange={reload} />
    </div>
  )
}
