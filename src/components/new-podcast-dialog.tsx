import { useState, type FormEvent, type ReactNode } from 'react'
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
import { Field, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { createMyPodcast } from '~/functions/podcasts'
import { newPodcastSchema } from '~/lib/podcast-schema'

// Wraps a trigger (a button or link) that opens the "New podcast" form.
export function NewPodcastDialog({ children }: { children: ReactNode }) {
  const router = useRouter()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = newPodcastSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)))
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      const podcast = await createMyPodcast({ data: parsed.data })
      setOpen(false)
      // Reload route data so the sidebar and home page list the new podcast.
      await router.invalidate()
      await navigate({ to: '/podcasts/$slug', params: { slug: podcast.slug } })
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
        if (next) setError(undefined)
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New podcast</DialogTitle>
          <DialogDescription>You can add episodes once it's created.</DialogDescription>
        </DialogHeader>
        <form id="new-podcast" onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="podcast-title">Title</FieldLabel>
              <Input id="podcast-title" name="title" autoComplete="off" required maxLength={100} />
            </Field>
            <Field>
              <FieldLabel htmlFor="podcast-description">Description</FieldLabel>
              <Textarea id="podcast-description" name="description" maxLength={4000} />
            </Field>
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
