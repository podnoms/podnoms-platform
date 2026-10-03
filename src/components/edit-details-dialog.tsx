import { useState, type FormEvent } from 'react'
import { ImageField, imageIdToSave, type ImageValue } from '~/components/image-field'
import { RichTextEditor } from '~/components/rich-text-editor'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'

export type Details = {
  title: string
  description: string | null
  imageUrl: string | null
}

export type DetailsChange = {
  title: string
  description: string
  // Left out to keep the image, null to remove it.
  imageId: string | null | undefined
}

// Edits the title, artwork and description of a podcast or an episode.
export function EditDetailsDialog({
  open,
  onOpenChange,
  heading,
  description,
  details,
  maxTitleLength,
  imageContext,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  heading: string
  description: string
  details: Details
  maxTitleLength: number
  // More for a random image to go on, e.g. an episode's podcast title.
  imageContext?: string
  // Resolves once saved; the form shows an error if it throws.
  onSave: (change: DetailsChange) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts from the saved details. */}
        <DetailsForm
          details={details}
          maxTitleLength={maxTitleLength}
          imageContext={imageContext}
          onSave={onSave}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function DetailsForm({
  details,
  maxTitleLength,
  imageContext,
  onSave,
  onSaved,
}: {
  details: Details
  maxTitleLength: number
  imageContext?: string
  onSave: (change: DetailsChange) => Promise<void>
  onSaved: () => void
}) {
  const [title, setTitle] = useState(details.title)
  const [descriptionHtml, setDescriptionHtml] = useState(details.description ?? '')
  const [image, setImage] = useState<ImageValue>({ kind: 'keep' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim()) {
      setError('Give it a title')
      return
    }
    setError(undefined)
    setPending(true)
    try {
      await onSave({ title: title.trim(), description: descriptionHtml, imageId: imageIdToSave(image) })
      onSaved()
    } catch {
      setError('Something went wrong saving your changes. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <form id="edit-details" onSubmit={onSubmit} className="min-w-0">
        <FieldGroup>
          <div className="flex flex-col gap-6 sm:flex-row">
            <Field className="w-auto shrink-0">
              <FieldLabel htmlFor="details-image">Artwork</FieldLabel>
              <ImageField
                id="details-image"
                imageUrl={details.imageUrl}
                value={image}
                onChange={setImage}
                suggest={() => ({ title, description: descriptionHtml, context: imageContext })}
              />
            </Field>
            <Field className="min-w-0">
              <FieldLabel htmlFor="details-title">Title</FieldLabel>
              <Input
                id="details-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={maxTitleLength}
                autoComplete="off"
                required
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="details-description">Description</FieldLabel>
            <RichTextEditor
              id="details-description"
              value={descriptionHtml}
              onChange={setDescriptionHtml}
              placeholder="What's it about?"
            />
          </Field>
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
      </form>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button type="submit" form="edit-details" disabled={pending || image.kind === 'uploading'}>
          Save
        </Button>
      </DialogFooter>
    </>
  )
}
