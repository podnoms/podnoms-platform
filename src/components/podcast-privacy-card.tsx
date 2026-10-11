import { useState } from 'react'
import { CopyField } from '~/components/copy-field'
import { Icons } from '~/components/icons'
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
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Switch } from '~/components/ui/switch'
import { resetMyFeedKey, setMyPodcastPrivacy } from '~/functions/podcasts'

// Making a podcast private: its pages are then only shown to its owner, and
// its feed only works from the private feed URL, which can be reset to cut
// off everyone it was given to.
export function PodcastPrivacyCard({
  podcast,
  onChanged,
}: {
  podcast: { id: string; private: boolean; feedUrl: string }
  onChanged: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [error, setError] = useState<string>()

  async function run(action: () => Promise<unknown>) {
    setPending(true)
    setError(undefined)
    try {
      await action()
      await onChanged()
    } catch {
      setError('Something went wrong saving that. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy</CardTitle>
        <CardDescription>
          A private podcast is only for the listeners you choose: give them its private feed URL.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="podcast-private">Private podcast</FieldLabel>
              <FieldDescription>
                Its pages, share links and embeds only work for you, it's kept out of search engines and directories,
                and its feed and audio only work from the private feed URL.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="podcast-private"
              checked={podcast.private}
              disabled={pending}
              onCheckedChange={(value) => void run(() => setMyPodcastPrivacy({ data: { id: podcast.id, private: value } }))}
            />
          </Field>
          {podcast.private && (
            <Field>
              <CopyField label="Private feed URL" value={podcast.feedUrl} />
              <FieldDescription>
                Anyone with this URL can listen. If it gets passed on, reset it: the old URL stops working, so the
                listeners you still want will need the new one.
              </FieldDescription>
              <Button variant="outline" className="w-fit" disabled={pending} onClick={() => setConfirmReset(true)}>
                <Icons.retry />
                Reset private feed URL
              </Button>
            </Field>
          )}
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
      </CardContent>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the private feed URL?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone subscribed with the current URL will stop getting episodes until you give them the new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => void run(() => resetMyFeedKey({ data: { id: podcast.id } }))}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
