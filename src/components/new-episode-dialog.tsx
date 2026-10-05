import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { AudioFileField, audioSourceChoices, useAudioUpload, type AudioSource } from '~/components/audio-file-field'
import { ChoiceCards } from '~/components/choice-cards'
import { ImageField, imageIdToSave, type ImageValue } from '~/components/image-field'
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
import { linkEpisodeSchema, uploadEpisodeSchema } from '~/lib/episode-schema'


// Wraps a trigger (a button) that opens the "New episode" form for a podcast.
export function NewEpisodeDialog({
  podcastId,
  podcastTitle,
  children,
}: {
  podcastId: string
  podcastTitle: string
  children: ReactNode
}) {
  const descriptionInput = useRef<HTMLTextAreaElement>(null)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<AudioSource>('link')
  const [title, setTitle] = useState('')
  const [image, setImage] = useState<ImageValue>({ kind: 'keep' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  // The title filled in from the last upload, replaced by the next one unless edited.
  const autoTitle = useRef('')
  const uploadState = useAudioUpload((result) => {
    setError(undefined)
    setTitle((current) => (current === '' || current === autoTitle.current ? result.title : current))
    autoTitle.current = result.title
  })
  const { upload } = uploadState

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = { ...Object.fromEntries(new FormData(event.currentTarget)), podcastId, imageId: imageIdToSave(image) ?? undefined }
    const parsed =
      source === 'link'
        ? linkEpisodeSchema.safeParse(fields)
        : uploadEpisodeSchema.safeParse({
            ...fields,
            uploadId: upload.status === 'ready' ? upload.result.uploadId : undefined,
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
        if (next) {
          setError(undefined)
          setTitle('')
          setImage({ kind: 'keep' })
          autoTitle.current = ''
        } else {
          uploadState.clear()
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New episode</DialogTitle>
          <DialogDescription>
            It's turned into an episode in the background, so you can carry on meanwhile.
          </DialogDescription>
        </DialogHeader>
        <form id="new-episode" onSubmit={onSubmit}>
          <FieldGroup>
            <ChoiceCards
              label="Where the audio comes from"
              value={source}
              onValueChange={(next) => {
                setSource(next)
                setError(undefined)
              }}
              choices={audioSourceChoices}
            />
            {source === 'link' ? (
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
            ) : (
              <AudioFileField id="episode-file" state={uploadState} />
            )}
            <div className="flex flex-col gap-6 sm:flex-row">
              <Field className="w-auto shrink-0">
                <FieldLabel htmlFor="episode-image">Artwork</FieldLabel>
                <ImageField
                  id="episode-image"
                  imageUrl={null}
                  value={image}
                  onChange={setImage}
                  suggest={() => ({ title, description: descriptionInput.current?.value, context: podcastTitle })}
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor="episode-title">Title</FieldLabel>
                <Input
                  id="episode-title"
                  name="title"
                  autoComplete="off"
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <FieldDescription>
                  {source === 'link' ? "Leave blank to use the video's title." : "Leave blank to use the file's title or name."}
                </FieldDescription>
                {source === 'link' && <FieldDescription>Leave the artwork empty to use the video's thumbnail.</FieldDescription>}
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="episode-description">Description</FieldLabel>
              <Textarea ref={descriptionInput} id="episode-description" name="description" maxLength={4000} />
              {source === 'link' && <FieldDescription>Leave blank to use the video's description.</FieldDescription>}
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            type="submit"
            form="new-episode"
            disabled={pending || image.kind === 'uploading' || (source === 'file' && upload.status !== 'ready')}
          >
            Add episode
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
