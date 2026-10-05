import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useAudioUploads, type QueuedAudioUpload } from '~/components/audio-file-field'
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
import { FieldDescription, FieldError } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Progress } from '~/components/ui/progress'
import { createMyEpisodes } from '~/functions/podcasts'
import { bulkUploadEpisodesSchema, maxBulkUploadFiles, maxUploadBytes } from '~/lib/episode-schema'
import { formatBytes, formatClock } from '~/lib/format'

// Wraps a trigger (a button) that opens a form for uploading a folder of audio
// files (or several chosen at once), each to become an episode of the podcast.
export function BulkUploadDialog({ podcastId, children }: { podcastId: string; children: ReactNode }) {
  const router = useRouter()
  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  // Titles the user has typed, by upload; the others use the file's own title.
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const { uploads, add, remove, clear } = useAudioUploads(maxBulkUploadFiles)

  const ready = uploads.filter((upload) => upload.status === 'ready')
  const busy = uploads.some((upload) => upload.status === 'queued' || upload.status === 'uploading')

  function onFilesChosen(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0) return
    const { notAudio, overLimit } = add(files)
    setError(undefined)
    setNotice(
      [
        notAudio > 0 && `${notAudio} ${notAudio === 1 ? "file wasn't" : "files weren't"} audio or video, so ${notAudio === 1 ? 'was' : 'were'} left out.`,
        overLimit > 0 && `Only ${maxBulkUploadFiles} files can be uploaded at once, so ${overLimit} more ${overLimit === 1 ? 'was' : 'were'} left out.`,
      ]
        .filter(Boolean)
        .join(' ') || undefined,
    )
  }

  async function onSubmit() {
    const parsed = bulkUploadEpisodesSchema.safeParse({
      podcastId,
      episodes: ready.map((upload) => ({ uploadId: upload.result.uploadId, title: titles[upload.id] })),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      await createMyEpisodes({ data: parsed.data })
      setOpen(false)
      clear()
      // Reload the podcast page so the new episodes are listed.
      await router.invalidate()
    } catch {
      setError('Something went wrong adding the episodes. Please try again.')
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
          setNotice(undefined)
          setTitles({})
        } else {
          clear()
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload a folder</DialogTitle>
          <DialogDescription>
            Each audio file becomes an episode, in the order of the files' names. They're turned into episodes in the
            background, so you can carry on meanwhile.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {/* webkitdirectory picks a whole folder; React doesn't know the attribute, so it's set directly. */}
            <input
              ref={(input) => {
                folderInput.current = input
                input?.setAttribute('webkitdirectory', '')
              }}
              type="file"
              multiple
              className="sr-only"
              onChange={onFilesChosen}
            />
            <input
              ref={filesInput}
              type="file"
              multiple
              accept="audio/*,video/*"
              className="sr-only"
              onChange={onFilesChosen}
            />
            <Button type="button" variant="outline" onClick={() => folderInput.current?.click()}>
              <Icons.uploadFolder />
              Choose folder
            </Button>
            <Button type="button" variant="outline" onClick={() => filesInput.current?.click()}>
              <Icons.upload />
              Choose files
            </Button>
          </div>
          <FieldDescription>
            Up to {maxBulkUploadFiles} files, each up to {formatBytes(maxUploadBytes)}. Anything that isn't audio or
            video, like artwork, is left out.
          </FieldDescription>
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
          {uploads.length > 0 && (
            <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {uploads.map((upload) => (
                <UploadRow
                  key={upload.id}
                  upload={upload}
                  title={titles[upload.id]}
                  onTitleChange={(title) => setTitles((current) => ({ ...current, [upload.id]: title }))}
                  onRemove={() => remove(upload.id)}
                />
              ))}
            </ul>
          )}
          {error && <FieldError>{error}</FieldError>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={onSubmit} disabled={pending || busy || ready.length === 0}>
            {ready.length === 1 ? 'Add 1 episode' : `Add ${ready.length} episodes`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// A file in the list: its title once uploaded, else its progress or what's wrong with it.
function UploadRow({
  upload,
  title,
  onTitleChange,
  onRemove,
}: {
  upload: QueuedAudioUpload
  title: string | undefined
  onTitleChange: (title: string) => void
  onRemove: () => void
}) {
  const detail =
    upload.status === 'queued'
      ? 'Waiting…'
      : upload.status === 'uploading'
        ? upload.percent < 100
          ? `${upload.percent}%`
          : 'Checking…'
        : upload.status === 'ready'
          ? [formatBytes(upload.file.size), upload.result.durationSeconds ? formatClock(upload.result.durationSeconds) : null]
              .filter(Boolean)
              .join(' · ')
          : null

  return (
    <li className="flex flex-col gap-2 rounded-md border px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <Icons.audioFile className="size-4 shrink-0 text-muted-foreground" />
        {upload.status === 'ready' ? (
          <Input
            aria-label={`Title for ${upload.file.name}`}
            className="h-8 min-w-0 flex-1"
            maxLength={200}
            value={title ?? upload.result.title}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{upload.file.name}</span>
        )}
        {detail && <span className="shrink-0 text-muted-foreground tabular-nums">{detail}</span>}
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove}>
          <Icons.close />
          <span className="sr-only">{upload.status === 'uploading' ? 'Cancel upload' : 'Remove file'}</span>
        </Button>
      </div>
      {upload.status === 'ready' && (
        <span className="truncate text-xs text-muted-foreground">{upload.file.webkitRelativePath || upload.file.name}</span>
      )}
      {upload.status === 'uploading' && (
        <Progress value={upload.percent} className={upload.percent === 100 ? 'animate-pulse' : undefined} />
      )}
      {upload.status === 'failed' && <p className="text-sm text-destructive">{upload.message}</p>}
    </li>
  )
}
