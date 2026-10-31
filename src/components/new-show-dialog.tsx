import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router'
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
import { TagInput } from '~/components/tag-input'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { createMyChannelShow, fetchMyChannelLimit } from '~/functions/channels'
import { createMyShow } from '~/functions/shows'
import { newChannelShowSchema } from '~/lib/channel-schema'
import { newShowSchema } from '~/lib/show-schema'
import { channelProviders } from '~/lib/platforms'

type Start = 'blank' | 'channel'

// Wraps a trigger (a button or link) that opens the "New show" form.
export function NewShowDialog({ children }: { children: ReactNode }) {
  const router = useRouter()
  const navigate = useNavigate()
  // Admins' shows import everything, not just the newest uploads.
  const isAdmin = useRouteContext({ from: '__root__' }).session?.user.isAdmin ?? false
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [start, setStart] = useState<Start>('blank')
  const [tags, setTags] = useState<string[]>([])
  // How many uploads a channel show starts with; fetched when it's chosen.
  const [channelLimit, setChannelLimit] = useState<number>()

  useEffect(() => {
    if (open && start === 'channel' && channelLimit === undefined) {
      fetchMyChannelLimit().then(setChannelLimit, () => {})
    }
  }, [open, start, channelLimit])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = { ...Object.fromEntries(new FormData(event.currentTarget)), tags }
    const parsed = start === 'channel' ? newChannelShowSchema.safeParse(form) : newShowSchema.safeParse(form)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      const created =
        'url' in parsed.data
          ? await createMyChannelShow({ data: parsed.data })
          : await createMyShow({ data: parsed.data })
      if ('error' in created) {
        setError(created.error)
        return
      }
      const show = created.value
      setOpen(false)
      // Reload route data so the sidebar and home page list the new show.
      // `sync` waits for the reload: otherwise it runs in the background and
      // the navigation below aborts it, leaving the sidebar without the show.
      await router.invalidate({ sync: true })
      await navigate({ to: '/$slug', params: { slug: show.slug } })
    } catch {
      setError('Something went wrong creating your show. Please try again.')
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
          setTags([])
          // The limit may have been changed by an admin since.
          setChannelLimit(undefined)
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New show</DialogTitle>
          <DialogDescription className="sr-only">Start a blank show, or one that follows a channel.</DialogDescription>
        </DialogHeader>
        <form id="new-show" onSubmit={onSubmit}>
          <FieldGroup>
            <ChoiceCards
              label="How to start the show"
              value={start}
              onValueChange={(next) => {
                setStart(next)
                setError(undefined)
              }}
              choices={[
                { value: 'blank', icon: Icons.add, title: 'Blank show', hint: 'Add episodes yourself' },
                {
                  value: 'channel',
                  icon: Icons.broadcast,
                  title: 'From a channel',
                  hint: 'A channel or playlist',
                },
              ]}
            />
            {start === 'blank' ? (
              <>
                <Field>
                  <FieldLabel htmlFor="show-title">Title</FieldLabel>
                  <Input id="show-title" name="title" autoComplete="off" required maxLength={100} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="show-description">Description</FieldLabel>
                  <Textarea id="show-description" name="description" maxLength={4000} />
                </Field>
              </>
            ) : (
              <Field>
                <FieldLabel htmlFor="show-channel">Channel or playlist link</FieldLabel>
                <Input
                  id="show-channel"
                  name="url"
                  type="url"
                  placeholder={channelProviders[0]!.example}
                  autoComplete="off"
                  required
                />
                <FieldDescription>
                  {isAdmin
                    ? 'Everything on it becomes an episode, and new ones are added as they come out.'
                    : channelLimit === 0
                      ? "Your account can't import from channels yet."
                      : `Its newest ${channelLimit ? `${channelLimit} ` : ''}uploads become episodes, and new ones are added as they come out.`}{' '}
                  The title, description and artwork come from the channel or playlist; you can change them afterwards.
                </FieldDescription>
              </Field>
            )}
            <TagInput id="show-tags" value={tags} onChange={setTags} disabled={pending} />
            <Field>
              <FieldLabel htmlFor="show-domain">
                Custom domain <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input
                id="show-domain"
                name="customDomain"
                placeholder="pod.example.com"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={300}
              />
              <FieldDescription>
                Serve the show from your own domain. You'll get the DNS records to add on its Distribution tab.
              </FieldDescription>
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" form="new-show" disabled={pending}>
            Create show
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
