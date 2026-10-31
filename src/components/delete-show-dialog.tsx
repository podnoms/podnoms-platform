import { useState, type FormEvent } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { usePlayer } from '~/components/player/player-provider'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { deleteMyShow } from '~/functions/shows'

// Deleting a show can't be undone, so the owner types its title to confirm.
export function DeleteShowDialog({
  show,
  open,
  onOpenChange,
}: {
  show: { id: string; title: string; slug: string; episodeCount: number }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const navigate = useNavigate()
  const player = usePlayer()
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string>()
  const confirmed = typed.trim() === show.title.trim()

  function change(next: boolean) {
    if (deleting) return
    if (!next) {
      setTyped('')
      setError(undefined)
    }
    onOpenChange(next)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!confirmed) return
    setDeleting(true)
    setError(undefined)
    try {
      await deleteMyShow({ data: { id: show.id } })
      // Its audio is gone, so stop it if it's playing.
      if (player.episode?.showSlug === show.slug) player.close()
      await navigate({ to: '/' })
      // The sidebar's list of shows.
      await router.invalidate()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong deleting the show. Please try again.')
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {show.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              {show.episodeCount > 0
                ? `Its ${show.episodeCount === 1 ? 'episode' : `${show.episodeCount} episodes`} and their audio will be deleted too. `
                : ''}
              Its feed and pages stop working, and its followers, likes and stats are lost. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="delete-show-title">Type the show's title to confirm</FieldLabel>
            <Input
              id="delete-show-title"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
              disabled={deleting}
            />
            <FieldDescription>{show.title}</FieldDescription>
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!confirmed || deleting}>
              {deleting ? 'Deleting…' : 'Delete show'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
