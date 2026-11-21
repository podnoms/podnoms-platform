import { useState, type FormEvent, type ReactNode } from 'react'
import { ImageField, imageIdToSave, type ImageValue } from '~/components/image-field'
import { RichTextEditor } from '~/components/rich-text-editor'
import { PaidFeatureNotice, usePaidAccess } from '~/components/paid-feature-notice'
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
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { showSlugField } from '~/lib/show-schema'

export type Details = {
  title: string
  description: string | null
  imageUrl: string | null
  tags?: { id: string; name: string }[]
  // A show's, which the form then lets the owner change.
  slug?: string
  // What comes before it in the address, after the host: the owner's slug.
  slugPrefix?: string
  // Its privacy, which the form then lets the owner change: a show's (see
  // setShowPrivacy; making one private is a paid feature) or an episode's
  // (setEpisodePrivacy), as `kind` says.
  private?: boolean
  kind?: 'show' | 'episode'
}

export type DetailsChange = {
  title: string
  description: string
  tags: string[]
  // Left out to keep the image, null to remove it.
  imageId: string | null | undefined
  // Only given when it's changed.
  slug?: string
  // Only given when it's changed; the caller saves it (setMyShowPrivacy or setMyEpisodePrivacy).
  private?: boolean
}

// Edits the title, artwork, description and tags of a show or an episode.
export function EditDetailsDialog({
  open,
  onOpenChange,
  heading,
  description,
  details,
  maxTitleLength,
  imageContext,
  addressHint,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  heading: string
  description: string
  details: Details
  maxTitleLength: number
  // More for a random image to go on, e.g. an episode's show title.
  imageContext?: string
  // Shown under a show's address, e.g. how to use a domain of their own instead.
  addressHint?: ReactNode
  // Resolves once saved, or with a message for the form to show; the form
  // shows a general error if it throws.
  onSave: (change: DetailsChange) => Promise<string | void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts from the saved details. */}
        <DetailsForm
          details={details}
          maxTitleLength={maxTitleLength}
          imageContext={imageContext}
          addressHint={addressHint}
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
  addressHint,
  onSave,
  onSaved,
}: {
  details: Details
  maxTitleLength: number
  imageContext?: string
  addressHint?: ReactNode
  onSave: (change: DetailsChange) => Promise<string | void>
  onSaved: () => void
}) {
  const [title, setTitle] = useState(details.title)
  const [descriptionHtml, setDescriptionHtml] = useState(details.description ?? '')
  const [image, setImage] = useState<ImageValue>({ kind: 'keep' })
  const [tags, setTags] = useState(details.tags?.map((tag) => tag.name) ?? [])
  const [slug, setSlug] = useState(details.slug ?? '')
  const slugChanged = details.slug !== undefined && slug.trim().toLowerCase() !== details.slug
  const isShow = details.kind !== 'episode'
  // Only making a show private needs paid access; episodes are free, and a
  // private show can always be made public.
  const paidAccess = usePaidAccess()
  const privacyLocked = isShow && !paidAccess && !details.private
  const [isPrivate, setIsPrivate] = useState(details.private ?? false)
  const privacyChanged = details.private !== undefined && isPrivate !== details.private
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim()) {
      setError('Give it a title')
      return
    }
    const newSlug = slugChanged ? showSlugField.safeParse(slug) : null
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
        ...(privacyChanged && { private: isPrivate }),
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
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {location.host}/{details.slugPrefix}
                  </span>
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
                    The show's page and feed move to the new address. The old ones redirect there, so podcast
                    apps and directories follow it, unless you give another of your shows the old one.
                  </FieldDescription>
                )}
                {addressHint && <FieldDescription>{addressHint}</FieldDescription>}
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
            {details.private !== undefined && (
              <>
                {privacyLocked && <PaidFeatureNotice feature="privateShows" />}
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="details-private">{isShow ? 'Private show' : 'Private episode'}</FieldLabel>
                    <FieldDescription>
                      {isShow
                        ? "Only you can see it and its episodes: it's left out of Explore, search, other people's feeds and directories. Listeners you choose can still subscribe with its private feed URL, which you'll find under Privacy on its manage page."
                        : "Only you can see it: it's left out of the show's page and feed, Explore, search and other people's feeds, and its share link stops working for anyone else."}
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="details-private"
                    checked={isPrivate}
                    disabled={pending || privacyLocked}
                    onCheckedChange={setIsPrivate}
                  />
                </Field>
              </>
            )}
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
