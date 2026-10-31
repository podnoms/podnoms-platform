// The shows the user follows, on the notification settings, each with a
// switch to mute it: no desktop notifications or emails about it, though the
// user still follows it.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Icons } from '~/components/icons'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { FieldError } from '~/components/ui/field'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '~/components/ui/item'
import { Switch } from '~/components/ui/switch'
import { saveFollowNotify } from '~/functions/profile'
import { imageSrc } from '~/lib/images'

type FollowedShow = { showId: string; title: string; slug: string; imageUrl: string | null; notify: boolean }

export function FollowedShowNotifications({
  follows,
  onChange,
}: {
  follows: FollowedShow[]
  onChange: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function setNotify(showId: string, notify: boolean) {
    setBusy(true)
    setError(undefined)
    try {
      await saveFollowNotify({ data: { showId, notify } })
      await onChange()
    } catch {
      setError('Something went wrong saving that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shows you follow</CardTitle>
        <CardDescription>
          Turn one off to stop hearing about it, by desktop notification or email, but keep following it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {follows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You don't follow any shows yet.{' '}
            <Link to="/explore" className="text-primary hover:underline">
              Explore shows
            </Link>{' '}
            to find some.
          </p>
        ) : (
          <ItemGroup className="gap-1">
            {follows.map((show) => (
              <Item key={show.showId} size="sm" variant="outline">
                <ItemMedia variant="image">
                  {show.imageUrl ? (
                    <img src={imageSrc(show.imageUrl, 80)} alt="" />
                  ) : (
                    <Icons.logo className="size-5 text-muted-foreground" />
                  )}
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    <Link to="/$slug" params={{ slug: show.slug }} className="hover:underline">
                      {show.title}
                    </Link>
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Switch
                    aria-label={`Notifications about ${show.title}`}
                    checked={show.notify}
                    disabled={busy}
                    onCheckedChange={(value) => void setNotify(show.showId, value)}
                  />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
        {error && <FieldError>{error}</FieldError>}
      </CardContent>
    </Card>
  )
}
