import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
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
  DialogTrigger,
} from '~/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Progress } from '~/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'
import { createMyEpisode } from '~/functions/podcasts'
import { linkEpisodeSchema, maxUploadBytes, uploadEpisodeSchema } from '~/lib/episode-schema'
import { formatBytes, formatClock } from '~/lib/format'
import { isAbort, uploadFile } from '~/lib/upload'
import type { UploadedAudio } from '~/server/uploads.server'

type Source = 'link' | 'file'

type Upload =
  | { status: 'idle' }
  | { status: 'uploading'; file: File; percent: number; abort: () => void }
  | { status: 'ready'; file: File; result: UploadedAudio }
  | { status: 'failed'; file: File; message: string }

// Wraps a trigger (a button) that opens the "New episode" form for a podcast.
export function NewEpisodeDialog({ podcastId, children }: { podcastId: string; children: ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<Source>('link')
  const [title, setTitle] = useState('')
  const [upload, setUpload] = useState<Upload>({ status: 'idle' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)
  // The title filled in from the last upload, replaced by the next one unless edited.
  const autoTitle = useRef('')

  function clearUpload() {
    if (upload.status === 'uploading') upload.abort()
    setUpload({ status: 'idle' })
    if (fileInput.current) fileInput.current.value = ''
  }

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (upload.status === 'uploading') upload.abort()
    setError(undefined)
    if (file.size > maxUploadBytes) {
      setUpload({ status: 'failed', file, message: `That file is too big. The limit is ${formatBytes(maxUploadBytes)}.` })
      return
    }
    const url = `/api/uploads?filename=${encodeURIComponent(file.name)}`
    const { done, abort } = uploadFile<UploadedAudio>(url, file, (percent) =>
      setUpload((current) => (current.status === 'uploading' && current.file === file ? { ...current, percent } : current)),
    )
    setUpload({ status: 'uploading', file, percent: 0, abort })
    try {
      const result = await done
      setUpload((current) => (current.status === 'uploading' && current.file === file ? { status: 'ready', file, result } : current))
      setTitle((current) => (current === '' || current === autoTitle.current ? result.title : current))
      autoTitle.current = result.title
    } catch (uploadError) {
      if (isAbort(uploadError)) return
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError)
      setUpload((current) => (current.status === 'uploading' && current.file === file ? { status: 'failed', file, message } : current))
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = { ...Object.fromEntries(new FormData(event.currentTarget)), podcastId }
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

  const uploadDetail =
    upload.status === 'uploading'
      ? upload.percent < 100
        ? `${upload.percent}%`
        : 'Checking…'
      : upload.status === 'ready'
        ? [formatBytes(upload.file.size), upload.result.durationSeconds ? formatClock(upload.result.durationSeconds) : null]
            .filter(Boolean)
            .join(' · ')
        : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setError(undefined)
          setTitle('')
          autoTitle.current = ''
        } else {
          clearUpload()
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New episode</DialogTitle>
          <DialogDescription>
            Paste a link to a video or audio track, e.g. on YouTube, or upload an audio file. It's turned into an
            episode in the background.
          </DialogDescription>
        </DialogHeader>
        <form id="new-episode" onSubmit={onSubmit}>
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
              </TabsContent>
              <TabsContent value="file">
                <Field>
                  <FieldLabel htmlFor="episode-file">Audio file</FieldLabel>
                  <input
                    id="episode-file"
                    ref={fileInput}
                    type="file"
                    accept="audio/*,video/*"
                    className="sr-only"
                    onChange={onFileChosen}
                  />
                  {upload.status === 'idle' ? (
                    <Button type="button" variant="outline" className="w-fit" onClick={() => fileInput.current?.click()}>
                      <Icons.upload />
                      Choose file
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Icons.audioFile className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate">{upload.file.name}</span>
                        {uploadDetail && (
                          <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{uploadDetail}</span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className={uploadDetail ? undefined : 'ml-auto'}
                          onClick={clearUpload}
                        >
                          <Icons.close />
                          <span className="sr-only">{upload.status === 'uploading' ? 'Cancel upload' : 'Remove file'}</span>
                        </Button>
                      </div>
                      {upload.status === 'uploading' && (
                        <Progress value={upload.percent} className={upload.percent === 100 ? 'animate-pulse' : undefined} />
                      )}
                      {upload.status === 'failed' && <p className="text-sm text-destructive">{upload.message}</p>}
                    </div>
                  )}
                  <FieldDescription>
                    MP3, M4A, WAV, FLAC and the like, or a video to take the audio from. Up to{' '}
                    {formatBytes(maxUploadBytes)}.
                  </FieldDescription>
                </Field>
              </TabsContent>
            </Tabs>
            <Field>
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
            </Field>
            <Field>
              <FieldLabel htmlFor="episode-description">Description</FieldLabel>
              <Textarea id="episode-description" name="description" maxLength={4000} />
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
            disabled={pending || (source === 'file' && upload.status !== 'ready')}
          >
            Add episode
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
