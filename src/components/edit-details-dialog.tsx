import { useState, type FormEvent } from 'react'
import { ImageField, imageIdToSave, type ImageValue } from '~/components/image-field'
import { RichTextEditor } from '~/components/rich-text-editor'
import { TagInput } from '~/components/tag-input'
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { podcastSlugField } from '~/lib/podcast-schema'

export type Details = {
  title: string
  description: string | null
  imageUrl: string | null
  tags?: { id: string; name: string }[]
  // A podcast's, which the form then lets the owner change.
  slug?: string
}

export type DetailsChange = {
  title: string
  description: string
  tags: string[]
  // Left out to keep the image, null to remove it.
  imageId: string | null | undefined
  // Only given when it's changed.
  slug?: string
}

// Edits the title, artwork, description and tags of a podcast or an episode.
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
  // Resolves once saved, or with a message for the form to show; the form
  // shows a general error if it throws.
  onSave: (change: DetailsChange) => Promise<string | void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
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
  onSave: (change: DetailsChange) => Promise<string | void>
  onSaved: () => void
}) {
  const [title, setTitle] = useState(details.title)
  const [descriptionHtml, setDescriptionHtml] = useState(details.description ?? '')
  const [image, setImage] = useState<ImageValue>({ kind: 'keep' })
  const [tags, setTags] = useState(details.tags?.map((tag) => tag.name) ?? [])
  const [slug, setSlug] = useState(details.slug ?? '')
  const slugChanged = details.slug !== undefined && slug.trim().toLowerCase() !== details.slug
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim()) {
      setError('Give it a title')
      return
    }
    const newSlug = slugChanged ? podcastSlugField.safeParse(slug) : null
    if (newSlug && !newSlug.success) {
      setError(newSlug.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      const refused = await onSave({
        title: title.trim(),
        description: descriptionHtml,
        imageId: imageIdToSave(image),
        tags,
        ...(newSlug && { slug: newSlug.data }),
      })
      if (refused) return setError(refused)
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
          <FieldGroup className="min-w-0 flex-1">
            <Field>
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
            {details.slug !== undefined && (
              <Field>
                <FieldLabel htmlFor="details-slug">Address</FieldLabel>
                <div className="flex items-center gap-1">
                  <span className="shrink-0 text-sm text-muted-foreground">{location.host}/</span>
                  <Input
                    id="details-slug"
                    value={slug}
                    // Spaces become hyphens as you type; the rest is checked on saving.
                    onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/\s+/g, '-'))}
                    maxLength={60}
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                </div>
                {slugChanged && (
                  <FieldDescription>
                    The podcast's page and feed move to the new address, and the old ones stop working. Podcast apps
                    and directories using the old feed won't get new episodes until it's updated there.
                  </FieldDescription>
                )}
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="details-description">Description</FieldLabel>
              <RichTextEditor
                id="details-description"
                value={descriptionHtml}
                onChange={setDescriptionHtml}
                placeholder="What's it about?"
              />
            </Field>
            <TagInput id="details-tags" value={tags} onChange={setTags} disabled={pending} />
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </div>
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
