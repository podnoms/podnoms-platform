import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { Choice } from '~/components/choice-cards'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '~/components/ui/field'
import { Progress } from '~/components/ui/progress'
import { byFileName, isAudioFileName } from '~/lib/audio-files'
import { maxUploadBytes } from '~/lib/episode-schema'
import { formatBytes, formatClock } from '~/lib/format'
import { isAbort, uploadFileInParts } from '~/lib/upload'
import type { UploadedAudio } from '~/server/uploads.server'

// Where an episode's audio comes from, for the dialogs that ask.
export type AudioSource = 'link' | 'file'
export const audioSourceChoices: Choice<AudioSource>[] = [
  { value: 'link', icon: Icons.link, title: 'From a link', hint: 'YouTube, Mixcloud and more' },
  { value: 'file', icon: Icons.upload, title: 'Upload a file', hint: 'Audio or video' },
]

export type AudioUpload =
  | { status: 'idle' }
  | { status: 'uploading'; file: File; percent: number; abort: () => void }
  | { status: 'ready'; file: File; result: UploadedAudio }
  | { status: 'failed'; file: File; message: string }

// An audio file being uploaded (to /api/uploads) as soon as it's chosen, for
// AudioFileField. onUploaded is called once the server has checked it.
export function useAudioUpload(onUploaded?: (result: UploadedAudio) => void) {
  const [upload, setUpload] = useState<AudioUpload>({ status: 'idle' })
  const fileInput = useRef<HTMLInputElement>(null)

  function clear() {
    if (upload.status === 'uploading') upload.abort()
    setUpload({ status: 'idle' })
    if (fileInput.current) fileInput.current.value = ''
  }

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (upload.status === 'uploading') upload.abort()
    if (file.size > maxUploadBytes) {
      setUpload({ status: 'failed', file, message: `That file is too big. The limit is ${formatBytes(maxUploadBytes)}.` })
      return
    }
    const { done, abort } = uploadFileInParts<UploadedAudio>(file, (percent) =>
      setUpload((current) => (current.status === 'uploading' && current.file === file ? { ...current, percent } : current)),
    )
    setUpload({ status: 'uploading', file, percent: 0, abort })
    try {
      const result = await done
      setUpload((current) => (current.status === 'uploading' && current.file === file ? { status: 'ready', file, result } : current))
      onUploaded?.(result)
    } catch (uploadError) {
      if (isAbort(uploadError)) return
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError)
      setUpload((current) => (current.status === 'uploading' && current.file === file ? { status: 'failed', file, message } : current))
    }
  }

  return { upload, fileInput, clear, onFileChosen }
}

// Something to upload with several others: a file chosen on this computer, or
// one in cloud storage that the server copies across. `send` starts it,
// reporting progress as it goes, or null while there's none to report.
export type UploadItem = {
  name: string
  size: number
  // Where it is in the folder chosen, for the list.
  path: string
  send: (onProgress: (percent: number) => void) => { done: Promise<UploadedAudio>; abort: () => void }
}

// One of several files being uploaded, waiting its turn to begin with.
export type QueuedAudioUpload = { id: string; item: UploadItem } & (
  | { status: 'queued' }
  | { status: 'uploading'; percent: number | null; abort: () => void }
  | { status: 'ready'; result: UploadedAudio }
  | { status: 'failed'; message: string }
)

// A file on this computer, sent to /api/uploads.
export const localUploadItem = (file: File): UploadItem => ({
  name: file.name,
  size: file.size,
  path: file.webkitRelativePath || file.name,
  send: (onProgress) => uploadFileInParts<UploadedAudio>(file, onProgress),
})

// Several audio files (e.g. a folder of them) uploaded a few at a time, in
// name order, for BulkUploadDialog.
export function useAudioUploads(maxFiles: number, concurrency = 2) {
  const [uploads, setUploads] = useState<QueuedAudioUpload[]>([])
  const current = useRef(uploads)
  current.current = uploads

  const update = (id: string, change: (upload: QueuedAudioUpload) => QueuedAudioUpload) =>
    setUploads((list) => list.map((upload) => (upload.id === id ? change(upload) : upload)))

  function start(id: string, item: UploadItem) {
    const { done, abort } = item.send((percent) =>
      update(id, (upload) => (upload.status === 'uploading' ? { ...upload, percent } : upload)),
    )
    update(id, () => ({ id, item, status: 'uploading', percent: null, abort }))
    done.then(
      (result) => update(id, (upload) => (upload.status === 'uploading' ? { id, item, status: 'ready', result } : upload)),
      (error) => {
        if (isAbort(error)) return
        const message = error instanceof Error ? error.message : String(error)
        update(id, (upload) => (upload.status === 'uploading' ? { id, item, status: 'failed', message } : upload))
      },
    )
  }

  // Starts the next queued files while fewer than `concurrency` are uploading.
  useEffect(() => {
    const running = uploads.filter((upload) => upload.status === 'uploading').length
    const next = uploads.filter((upload) => upload.status === 'queued').slice(0, Math.max(0, concurrency - running))
    for (const upload of next) start(upload.id, upload.item)
  }, [uploads, concurrency])

  // Uploads still going when the form goes away are stopped.
  useEffect(() => () => clear(), [])

  // Queues the audio among the files chosen. Returns how many were left out
  // for not being audio (artwork, playlists, notes), or for going over maxFiles.
  function add(files: File[]) {
    const audio = files.filter((file) => isAudioFileName(file.name, file.type)).map(localUploadItem)
    return { ...addItems(audio), notAudio: files.length - audio.length }
  }

  // Queues files that are all audio. Returns how many went over maxFiles.
  function addItems(items: UploadItem[]) {
    const sorted = [...items].sort((a, b) => byFileName(a.path, b.path))
    const room = Math.max(0, maxFiles - current.current.length)
    const added: QueuedAudioUpload[] = sorted.slice(0, room).map((item) => {
      const id = crypto.randomUUID()
      return item.size > maxUploadBytes
        ? { id, item, status: 'failed', message: `That file is too big. The limit is ${formatBytes(maxUploadBytes)}.` }
        : { id, item, status: 'queued' }
    })
    setUploads((list) => [...list, ...added])
    return { notAudio: 0, overLimit: sorted.length - added.length }
  }

  function remove(id: string) {
    const upload = current.current.find((item) => item.id === id)
    if (upload?.status === 'uploading') upload.abort()
    setUploads((list) => list.filter((item) => item.id !== id))
  }

  function clear() {
    for (const upload of current.current) if (upload.status === 'uploading') upload.abort()
    setUploads([])
  }

  return { uploads, add, addItems, remove, clear }
}

// Choosing an audio file, with its upload's progress, or what's wrong with it.
export function AudioFileField({ id, state }: { id: string; state: ReturnType<typeof useAudioUpload> }) {
  const { upload, fileInput, clear, onFileChosen } = state
  const detail =
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
    <Field>
      <FieldLabel htmlFor={id}>Audio file</FieldLabel>
      <input id={id} ref={fileInput} type="file" accept="audio/*,video/*" className="sr-only" onChange={onFileChosen} />
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
            {detail && <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{detail}</span>}
            <Button type="button" variant="ghost" size="icon-sm" className={detail ? undefined : 'ml-auto'} onClick={clear}>
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
        MP3, M4A, WAV, FLAC and the like, or a video to take the audio from. Up to {formatBytes(maxUploadBytes)}.
      </FieldDescription>
    </Field>
  )
}
