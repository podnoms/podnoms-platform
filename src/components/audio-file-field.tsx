import { useRef, useState, type ChangeEvent } from 'react'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '~/components/ui/field'
import { Progress } from '~/components/ui/progress'
import { maxUploadBytes } from '~/lib/episode-schema'
import { formatBytes, formatClock } from '~/lib/format'
import { isAbort, uploadFile } from '~/lib/upload'
import type { UploadedAudio } from '~/server/uploads.server'

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
    const url = `/api/uploads?filename=${encodeURIComponent(file.name)}`
    const { done, abort } = uploadFile<UploadedAudio>(url, file, (percent) =>
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
