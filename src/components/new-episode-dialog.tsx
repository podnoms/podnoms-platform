import { useState, type FormEvent, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { createMyEpisode } from '~/functions/podcasts'
import { newEpisodeSchema } from '~/lib/episode-schema'

// Wraps a trigger (a button) that opens the "New episode" form for a podcast.
export function NewEpisodeDialog({ podcastId, children }: { podcastId: string; children: ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = newEpisodeSchema.safeParse({
      ...Object.fromEntries(new FormData(event.currentTarget)),
      podcastId,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      await createMyEpisode({ data: parsed.data })
      setOpen(false)
      // Reload the podcast page so the new episode is listed.
      await router.invalidate()
    } catch {
      setError('Something went wrong adding the episode. Please try again.')
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
          <DialogTitle>New episode</DialogTitle>
          <DialogDescription>
            Paste a link to a video or audio track, e.g. on YouTube. It's downloaded and turned into an episode
            in the background.
          </DialogDescription>
        </DialogHeader>
        <form id="new-episode" onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="episode-source">Link</FieldLabel>
              <Input
                id="episode-source"
                name="sourceUrl"
                type="url"
                placeholder="https://www.youtube.com/watch?v=…"
                autoComplete="off"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="episode-title">Title</FieldLabel>
              <Input id="episode-title" name="title" autoComplete="off" maxLength={200} />
              <FieldDescription>Leave blank to use the video's title.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="episode-description">Description</FieldLabel>
              <Textarea id="episode-description" name="description" maxLength={4000} />
              <FieldDescription>Leave blank to use the video's description.</FieldDescription>
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" form="new-episode" disabled={pending}>
            Add episode
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
