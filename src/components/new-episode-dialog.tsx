import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { AudioFileField, audioSourceChoices, useAudioUpload, type AudioSource } from '~/components/audio-file-field'
import { ChoiceCards } from '~/components/choice-cards'
import { ImageField, imageIdToSave, type ImageValue } from '~/components/image-field'
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
  DialogTrigger,
} from '~/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import { createMyEpisode, lookUpEpisodeLink } from '~/functions/podcasts'
import { linkEpisodeSchema, linkLookupSchema, uploadEpisodeSchema } from '~/lib/episode-schema'
import { platformOf } from '~/lib/platforms'

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
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<AudioSource>('link')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState<ImageValue>({ kind: 'keep' })
  const [tags, setTags] = useState<string[]>([])
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
  const link = useLinkLookup(({ title, description, image }) => {
    // Each replaces what an earlier link filled in, but not what's been edited.
    const auto = autoFromLink.current
    if (title) setTitle((current) => (current === '' || current === auto.title ? title : current))
    if (description) setDescription((current) => (current === '' || current === auto.description ? description : current))
    if (image) {
      setImage((current) =>
        current.kind === 'keep' || (current.kind === 'uploaded' && current.imageId === auto.imageId)
          ? { kind: 'uploaded', ...image }
          : current,
      )
    }
    autoFromLink.current = { title: title ?? auto.title, description: description ?? auto.description, imageId: image?.imageId ?? auto.imageId }
  })
  // What the last link looked up filled in.
  const autoFromLink = useRef<{ title?: string; description?: string; imageId?: string }>({})

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = { ...Object.fromEntries(new FormData(event.currentTarget)), podcastId, imageId: imageIdToSave(image) ?? undefined, tags }
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
          setDescription('')
          setImage({ kind: 'keep' })
          setTags([])
          autoTitle.current = ''
          autoFromLink.current = {}
        } else {
          uploadState.clear()
          link.cancel()
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
                <div className="relative">
                  <Input
                    id="episode-source"
                    name="sourceUrl"
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    autoComplete="off"
                    required
                    className={link.looking ? 'pr-9' : undefined}
                    onChange={(event) => link.lookUp(event.target.value)}
                  />
                  {link.looking && (
                    <Spinner aria-label="Looking up the link" className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" />
                  )}
                </div>
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
                  suggest={() => ({ title, description, context: podcastTitle })}
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
              <Textarea
                id="episode-description"
                name="description"
                maxLength={4000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              {source === 'link' && <FieldDescription>Leave blank to use the video's description.</FieldDescription>}
            </Field>
            <TagInput id="episode-tags" value={tags} onChange={setTags} disabled={pending} />
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

type LinkDetails = Awaited<ReturnType<typeof lookUpEpisodeLink>>

// Looks up a link shortly after it's typed or pasted, if it's one to a
// platform we know, and hands its details to onFound. Only the latest link's
// details are handed over.
function useLinkLookup(onFound: (details: LinkDetails) => void) {
  const [looking, setLooking] = useState(false)
  const latest = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastLink = useRef('')
  const found = useRef(onFound)
  found.current = onFound
  useEffect(() => () => clearTimeout(timer.current), [])

  function cancel() {
    clearTimeout(timer.current)
    latest.current++
    lastLink.current = ''
    setLooking(false)
  }

  function lookUp(value: string) {
    const parsed = linkLookupSchema.safeParse({ sourceUrl: value })
    const sourceUrl = parsed.success ? parsed.data.sourceUrl : ''
    if (sourceUrl === lastLink.current) return
    cancel()
    if (!sourceUrl || platformOf(sourceUrl) === 'other') return
    lastLink.current = sourceUrl
    const id = latest.current
    setLooking(true)
    // After a moment, so a link being typed isn't looked up at every key.
    timer.current = setTimeout(async () => {
      try {
        const details = await lookUpEpisodeLink({ data: { sourceUrl } })
        if (id === latest.current) found.current(details)
      } catch {
        // The form works without it; the processor fills in what's left blank.
      } finally {
        if (id === latest.current) setLooking(false)
      }
    }, 300)
  }

  return { looking, lookUp, cancel }
}
