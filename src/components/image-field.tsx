import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { suggestArtwork } from '~/functions/images'
import type { ImageSuggestionInput } from '~/lib/image-search'
import { imageSrc } from '~/lib/images'
import type { ImageCredit } from '~/server/image-suggestions.server'
import { isAbort, uploadFile } from '~/lib/upload'
import { cn } from '~/lib/utils'

// What's happening to the image in an edit form. An uploaded image is only
// kept once the form is saved with its ID.
export type ImageValue =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'uploading'; previewUrl: string; abort: () => void }
  | { kind: 'uploaded'; previewUrl: string; imageId: string; credit?: ImageCredit }

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

// Square artwork that's clicked (or dropped on) to upload a replacement, with
// a button to remove it on hover. Pasting an image anywhere on the page, while
// it's shown, replaces it too. With
// `suggest`, it also offers a random image to suit what `suggest` returns:
// what's known so far about the podcast or episode.
export function ImageField({
  id,
  imageUrl,
  value,
  onChange,
  suggest,
}: {
  id?: string
  // The image currently saved, if any.
  imageUrl: string | null
  value: ImageValue
  onChange: (value: ImageValue) => void
  suggest?: () => Omit<ImageSuggestionInput, 'exclude'>
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>()
  const [suggesting, setSuggesting] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Images already suggested, so each click brings a new one.
  const suggested = useRef<string[]>([])
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

  async function suggestImage() {
    if (!suggest || suggesting) return
    if (latest.current.kind === 'uploading') latest.current.abort()
    setError(undefined)
    setSuggesting(true)
    try {
      const result = await suggestArtwork({ data: { ...suggest(), exclude: suggested.current } })
      if (!result.ok) return setError(result.error)
      const { imageId, previewUrl, photoId, credit } = result.suggestion
      suggested.current = [...suggested.current, photoId]
      onChange({ kind: 'uploaded', previewUrl, imageId, credit })
    } catch {
      setError("Couldn't get a random image. Please try again.")
    } finally {
      setSuggesting(false)
    }
  }

  const credit = value.kind === 'uploaded' ? value.credit : undefined

  return (
    <div className="flex w-40 flex-col gap-2">
      <div
        className={cn(
          'group relative size-40 overflow-hidden rounded-lg border bg-muted transition-colors',
          dragging && 'border-ring ring-[3px] ring-ring/50',
        )}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = imageFromClipboard(event.dataTransfer)
          if (file) void upload(file)
        }}
      >
        {shown && <img src={imageSrc(shown, 160)} alt="" className="size-full object-cover" />}
        {/* The whole image picks a file. Over an image, what it does only shows on hover. */}
        <button
          type="button"
          title={shown ? 'Change image' : 'Upload image'}
          onClick={() => fileInput.current?.click()}
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs outline-none transition',
            shown
              ? 'bg-black/55 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:group-hover:opacity-0'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
          )}
        >
          {shown ? <Icons.upload className="size-5" /> : <Icons.image className="size-8" />}
          <span className="font-medium">{shown ? 'Change' : 'Upload'}</span>
          <span className={shown ? 'text-white/75' : ''}>or drop or paste one</span>
        </button>
        {shown && (
          <Button
            type="button"
            variant="secondary"
            size="icon-xs"
            title="Remove image"
            className="absolute top-1.5 right-1.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
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
        {(value.kind === 'uploading' || suggesting) && (
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
      {suggest && (
        <Button type="button" variant="outline" size="sm" disabled={suggesting} onClick={suggestImage}>
          <Icons.random />
          Random image
        </Button>
      )}
      {credit && (
        <p className="text-xs text-muted-foreground">
          <ExternalLink href={credit.pageUrl}>Photo</ExternalLink>
          {credit.author && (
            <>
              {' '}
              by {credit.authorUrl ? <ExternalLink href={credit.authorUrl}>{credit.author}</ExternalLink> : credit.author}
            </>
          )}{' '}
          {credit.source === 'Pexels' ? 'on' : 'via'} <ExternalLink href={credit.sourceUrl}>{credit.source}</ExternalLink>
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  )
}
