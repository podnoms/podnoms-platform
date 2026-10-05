import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { Button } from '~/components/ui/button'
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
import { ChoiceCards } from '~/components/choice-cards'
import { Icons } from '~/components/icons'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { createMyChannelPodcast, fetchMyChannelLimit } from '~/functions/channels'
import { createMyPodcast } from '~/functions/podcasts'
import { newChannelPodcastSchema } from '~/lib/channel-schema'
import { newPodcastSchema } from '~/lib/podcast-schema'
import { channelProviders } from '~/lib/platforms'

type Start = 'blank' | 'channel'

// Wraps a trigger (a button or link) that opens the "New podcast" form.
export function NewPodcastDialog({ children }: { children: ReactNode }) {
  const router = useRouter()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [start, setStart] = useState<Start>('blank')
  // How many uploads a channel podcast starts with; fetched when it's chosen.
  const [channelLimit, setChannelLimit] = useState<number>()

  useEffect(() => {
    if (open && start === 'channel' && channelLimit === undefined) {
      fetchMyChannelLimit().then(setChannelLimit, () => {})
    }
  }, [open, start, channelLimit])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    const parsed = start === 'channel' ? newChannelPodcastSchema.safeParse(form) : newPodcastSchema.safeParse(form)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      const podcast =
        'url' in parsed.data
          ? await createMyChannelPodcast({ data: parsed.data })
          : await createMyPodcast({ data: parsed.data })
      setOpen(false)
      // Reload route data so the sidebar and home page list the new podcast.
      await router.invalidate()
      await navigate({ to: '/podcasts/$slug/manage', params: { slug: podcast.slug } })
    } catch {
      setError('Something went wrong creating your podcast. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setError(undefined)
          // The limit may have been changed by an admin since.
          setChannelLimit(undefined)
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New podcast</DialogTitle>
          <DialogDescription className="sr-only">Start a blank podcast, or one that follows a channel.</DialogDescription>
        </DialogHeader>
        <form id="new-podcast" onSubmit={onSubmit}>
          <FieldGroup>
            <ChoiceCards
              label="How to start the podcast"
              value={start}
              onValueChange={(next) => {
                setStart(next)
                setError(undefined)
              }}
              choices={[
                { value: 'blank', icon: Icons.add, title: 'Blank podcast', hint: 'Add episodes yourself' },
                {
                  value: 'channel',
                  icon: Icons.broadcast,
                  title: 'From a channel',
                  hint: channelProviders.map((p) => p.label).join(' or '),
                },
              ]}
            />
            {start === 'blank' ? (
              <>
                <Field>
                  <FieldLabel htmlFor="podcast-title">Title</FieldLabel>
                  <Input id="podcast-title" name="title" autoComplete="off" required maxLength={100} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="podcast-description">Description</FieldLabel>
                  <Textarea id="podcast-description" name="description" maxLength={4000} />
                </Field>
              </>
            ) : (
              <Field>
                <FieldLabel htmlFor="podcast-channel">Channel link</FieldLabel>
                <Input
                  id="podcast-channel"
                  name="url"
                  type="url"
                  placeholder={channelProviders[0]!.example}
                  autoComplete="off"
                  required
                />
                <FieldDescription>
                  {channelLimit === 0
                    ? "Your account can't import from channels yet."
                    : `Its newest ${channelLimit ? `${channelLimit} ` : ''}uploads become episodes, and new ones are added as they come out.`}{' '}
                  The title, description and artwork come from the channel; you can change them afterwards.
                </FieldDescription>
              </Field>
            )}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" form="new-podcast" disabled={pending}>
            Create podcast
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
