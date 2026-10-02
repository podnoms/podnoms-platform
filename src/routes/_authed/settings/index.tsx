import { useState, type FormEvent } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ImageField, imageIdToSave, type ImageValue } from '~/components/image-field'
import { RichTextEditor } from '~/components/rich-text-editor'
import { Button } from '~/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { fetchProfile, saveProfile } from '~/functions/profile'
import { editProfileSchema } from '~/lib/profile-schema'

export const Route = createFileRoute('/_authed/settings/')({
  loader: () => fetchProfile(),
  head: () => ({ meta: [{ title: 'Settings · podnoms' }] }),
  component: DetailsPage,
})

function DetailsPage() {
  const profile = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState(profile.name ?? '')
  const [descriptionHtml, setDescriptionHtml] = useState(profile.description ?? '')
  const [image, setImage] = useState<ImageValue>({ kind: 'keep' })
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const change = { name, description: descriptionHtml, imageId: imageIdToSave(image) }
    const parsed = editProfileSchema.safeParse(change)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setSaved(false)
    setPending(true)
    try {
      await saveProfile({ data: change })
      // Reloads this page and the session, so the avatar in the top nav updates too.
      await router.invalidate()
      setImage({ kind: 'keep' })
      setSaved(true)
    } catch {
      setError('Something went wrong saving your changes. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} onChange={() => setSaved(false)}>
      <FieldGroup>
        <div className="flex flex-col gap-6 sm:flex-row">
          <Field className="w-auto shrink-0">
            <FieldLabel htmlFor="profile-image">Avatar</FieldLabel>
            <ImageField
              id="profile-image"
              imageUrl={profile.imageUrl}
              value={image}
              onChange={(value) => {
                setImage(value)
                setSaved(false)
              }}
            />
          </Field>
          <FieldGroup className="min-w-0">
            <Field>
              <FieldLabel htmlFor="profile-name">Name</FieldLabel>
              <Input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                autoComplete="name"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input id="profile-email" value={profile.email ?? ''} disabled />
              <FieldDescription>Your email can't be changed.</FieldDescription>
            </Field>
          </FieldGroup>
        </div>
        <Field>
          <FieldLabel htmlFor="profile-description">Description</FieldLabel>
          <RichTextEditor
            id="profile-description"
            value={descriptionHtml}
            onChange={(value) => {
              setDescriptionHtml(value)
              setSaved(false)
            }}
            placeholder="A little about you"
          />
        </Field>
        {error && <FieldError>{error}</FieldError>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || image.kind === 'uploading'}>
            Save
          </Button>
          {saved && <span className="text-sm text-muted-foreground">Saved</span>}
        </div>
      </FieldGroup>
    </form>
  )
}
