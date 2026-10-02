import { useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { AudioFileField, useAudioUpload } from '~/components/audio-file-field'
import { Icons } from '~/components/icons'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { replaceMyEpisodeAudio } from '~/functions/podcasts'
import { replaceAudioLinkSchema, replaceAudioUploadSchema } from '~/lib/episode-schema'

type Source = 'link' | 'file'

// Gives an episode new audio, from a link or an uploaded file: a ready
// episode keeps its current audio until the new audio is ready; a failed one
// is tried again from the new source.
export function ReplaceAudioDialog({
  episodeId,
  failed,
  open,
  onOpenChange,
}: {
  episodeId: string
  failed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [source, setSource] = useState<Source>('link')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const uploadState = useAudioUpload(() => setError(undefined))
  const { upload } = uploadState

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed =
      source === 'link'
        ? replaceAudioLinkSchema.safeParse({ ...Object.fromEntries(new FormData(event.currentTarget)), id: episodeId })
        : replaceAudioUploadSchema.safeParse({
            id: episodeId,
            uploadId: upload.status === 'ready' ? upload.result.uploadId : undefined,
          })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      await replaceMyEpisodeAudio({ data: parsed.data })
      onOpenChange(false)
      await router.invalidate()
    } catch {
      setError('Something went wrong replacing the audio. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) {
          setError(undefined)
          setSource('link')
        } else {
          uploadState.clear()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace audio</DialogTitle>
          <DialogDescription>
            {failed
              ? "Paste a different link, or upload the audio yourself, to try this episode again. It keeps the details you've given it."
              : 'Paste a link or upload a new file. The episode keeps its title, description and artwork, and its current audio stays in the feed until the new audio is ready.'}
          </DialogDescription>
        </DialogHeader>
        <form id="replace-audio" onSubmit={onSubmit}>
          <FieldGroup>
            <Tabs
              value={source}
              onValueChange={(next) => {
                setSource(next as Source)
                setError(undefined)
              }}
            >
              <TabsList>
                <TabsTrigger value="link">
                  <Icons.link />
                  Link
                </TabsTrigger>
                <TabsTrigger value="file">
                  <Icons.upload />
                  Upload a file
                </TabsTrigger>
              </TabsList>
              <TabsContent value="link">
                <Field>
                  <FieldLabel htmlFor="replace-audio-source">Link</FieldLabel>
                  <Input
                    id="replace-audio-source"
                    name="sourceUrl"
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    autoComplete="off"
                    required
                  />
                  <FieldDescription>A YouTube, Mixcloud or SoundCloud link, or anything else with audio or video.</FieldDescription>
                </Field>
              </TabsContent>
              <TabsContent value="file">
                <AudioFileField id="replace-audio-file" state={uploadState} />
              </TabsContent>
            </Tabs>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" form="replace-audio" disabled={pending || (source === 'file' && upload.status !== 'ready')}>
            Replace audio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
