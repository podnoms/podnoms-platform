// Making a playlist or changing one's details: its name, a description, and
// whether it's public.
import { useState, type FormEvent } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import { playlistDescriptionMaxLength, playlistDetailsSchema, playlistTitleMaxLength } from '~/lib/playlist-schema'

export type PlaylistDetails = { title: string; description: string | null; private: boolean }

export function PlaylistDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // A playlist's details to edit; without them, a new one.
  initial?: PlaylistDetails
  // Throws if it couldn't be saved.
  onSave: (details: PlaylistDetails) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Remounted on each opening, so it starts from `initial`. */}
        {open && <PlaylistForm initial={initial} onSave={onSave} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function PlaylistForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: PlaylistDetails
  onSave: (details: PlaylistDetails) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [isPrivate, setPrivate] = useState(initial?.private ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = playlistDetailsSchema.safeParse({ title, description, private: isPrivate })
    if (!parsed.success) return setError(parsed.error.issues[0]?.message)
    setSaving(true)
    setError(undefined)
    try {
      await onSave(parsed.data)
    } catch {
      setError('Something went wrong saving that. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{initial ? 'Edit playlist' : 'New playlist'}</DialogTitle>
        <DialogDescription>Episodes from any podcasts, to play one after another.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="playlist-title">Name</FieldLabel>
          <Input
            id="playlist-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={playlistTitleMaxLength}
            autoFocus
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="playlist-description">Description</FieldLabel>
          <Textarea
            id="playlist-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={playlistDescriptionMaxLength}
            placeholder="Optional"
          />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="playlist-public">Public</FieldLabel>
            <FieldDescription>
              Anyone can see it, on your profile. Episodes they can't see (private ones) stay hidden from them.
            </FieldDescription>
          </FieldContent>
          <Switch id="playlist-public" checked={!isPrivate} onCheckedChange={(value) => setPrivate(!value)} />
        </Field>
        {error && <FieldError>{error}</FieldError>}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {initial ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}
