import { useEffect, useRef, useState } from 'react'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { imageSrc } from '~/lib/images'
import { isAbort, uploadFile } from '~/lib/upload'

// What's happening to the image in an edit form. An uploaded image is only
// kept once the form is saved with its ID.
export type ImageValue =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'uploading'; previewUrl: string; abort: () => void }
  | { kind: 'uploaded'; previewUrl: string; imageId: string }

// The `imageId` to save the form with: left out to keep the image, null to remove it.
export function imageIdToSave(value: ImageValue) {
  if (value.kind === 'remove') return null
  if (value.kind === 'uploaded') return value.imageId
  return undefined
}

// The image on the clipboard, e.g. one copied from a web page, or a screenshot.
export function imageFromClipboard(data: DataTransfer | null) {
  return Array.from(data?.files ?? []).find((file) => file.type.startsWith('image/')) ?? null
}

// Square artwork with buttons to upload a replacement or remove it. Pasting an
// image anywhere on the page, while it's shown, replaces it too.
export function ImageField({
  id,
  imageUrl,
  value,
  onChange,
}: {
  id?: string
  // The image currently saved, if any.
  imageUrl: string | null
  value: ImageValue
  onChange: (value: ImageValue) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>()
  // Tracks the latest value for the upload callbacks, which outlive renders.
  const latest = useRef(value)
  latest.current = value

  const previewUrl = value.kind === 'uploading' || value.kind === 'uploaded' ? value.previewUrl : null
  // Free the local preview once it's no longer shown.
  useEffect(() => (previewUrl ? () => URL.revokeObjectURL(previewUrl) : undefined), [previewUrl])
  // Stop an upload that's still running if the form closes.
  useEffect(() => () => (latest.current.kind === 'uploading' ? latest.current.abort() : undefined), [])

  const shown = value.kind === 'keep' ? imageUrl : value.kind === 'remove' ? null : value.previewUrl

  // Caught before it reaches the field being pasted into, such as the
  // description, which would otherwise try to paste the image as well.
  const uploadLatest = useRef(upload)
  uploadLatest.current = upload
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const file = imageFromClipboard(event.clipboardData)
      if (!file) return
      event.preventDefault()
      event.stopPropagation()
      void uploadLatest.current(file)
    }
    document.addEventListener('paste', onPaste, { capture: true })
    return () => document.removeEventListener('paste', onPaste, { capture: true })
  }, [])

  async function upload(file: File) {
    if (latest.current.kind === 'uploading') latest.current.abort()
    setError(undefined)
    const preview = URL.createObjectURL(file)
    const { done, abort } = uploadFile<{ imageId: string }>('/api/images', file)
    onChange({ kind: 'uploading', previewUrl: preview, abort })
    try {
      const { imageId } = await done
      onChange({ kind: 'uploaded', previewUrl: preview, imageId })
    } catch (uploadError) {
      if (isAbort(uploadError)) return
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError))
      onChange({ kind: 'keep' })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative size-32 overflow-hidden rounded-lg border bg-muted">
        {shown ? (
          <img src={imageSrc(shown, 128)} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Icons.image className="size-8 text-muted-foreground" />
          </div>
        )}
        {value.kind === 'uploading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Spinner />
          </div>
        )}
      </div>
      <input
        id={id}
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void upload(file)
        }}
      />
      <div className="flex gap-1">
        <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <Icons.upload />
          {shown ? 'Change' : 'Upload'}
        </Button>
        {shown && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Remove image"
            onClick={() => {
              if (value.kind === 'uploading') value.abort()
              setError(undefined)
              onChange(imageUrl ? { kind: 'remove' } : { kind: 'keep' })
            }}
          >
            <Icons.delete />
            <span className="sr-only">Remove image</span>
          </Button>
        )}
      </div>
      <p className="w-32 text-xs text-muted-foreground">Or paste an image.</p>
      {error && <p className="w-32 text-xs text-destructive">{error}</p>}
    </div>
  )
}
