import { useEffect, useRef, useState } from 'react'
import type { UploadItem } from '~/components/audio-file-field'
import { Icons } from '~/components/icons'
import { Button } from '~/components/ui/button'
import { FieldError } from '~/components/ui/field'
import { Spinner } from '~/components/ui/spinner'
import { fetchCloudFolder, importMyCloudFile } from '~/functions/cloud-storage'
import {
  cloudProviderNames,
  type CloudConnectedMessage,
  type CloudFile,
  type CloudFolder,
  type CloudProvider,
} from '~/lib/cloud-storage'
import { pluralise } from '~/lib/format'

// A file in cloud storage, which the server copies into the user's uploads.
// There's no progress to report, and stopping it only stops waiting for it.
function cloudUploadItem(provider: CloudProvider, file: CloudFile, folderPath: string): UploadItem {
  return {
    name: file.name,
    size: file.size,
    path: `${folderPath}/${file.name}`,
    send: () => {
      let aborted = false
      const done = importMyCloudFile({ data: { provider, fileId: file.id, name: file.name } }).then((result) => {
        if (aborted) throw new DOMException('Upload cancelled', 'AbortError')
        if ('error' in result) throw new Error(result.error)
        return result.upload
      })
      return { done, abort: () => (aborted = true) }
    },
  }
}

// Browsing the user's Dropbox or Box, signing in to it first in a popup, to
// choose a folder whose audio files are then added to the bulk upload.
export function CloudFolderPicker({
  provider,
  onChoose,
}: {
  provider: CloudProvider
  onChoose: (items: UploadItem[]) => void
}) {
  const name = cloudProviderNames[provider]
  const [folder, setFolder] = useState<CloudFolder>()
  const [loading, setLoading] = useState(true)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [error, setError] = useState<string>()
  // The folder to open once signed in.
  const wanted = useRef<string | undefined>(undefined)

  async function open(folderId?: string) {
    wanted.current = folderId
    setLoading(true)
    setError(undefined)
    try {
      const result = await fetchCloudFolder({ data: { provider, folderId } })
      if (wanted.current !== folderId) return
      if ('folder' in result) {
        setFolder(result.folder)
        setNeedsSignIn(false)
      } else if (result.connect) {
        setNeedsSignIn(true)
      } else {
        setError(result.error)
      }
    } catch {
      setError(`Couldn't reach ${name}. Please try again.`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void open()
    // The sign-in popup says how it went (see /api/cloud/$provider/callback).
    function onMessage(event: MessageEvent<CloudConnectedMessage>) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'cloud-storage-connected' || event.data.provider !== provider) return
      if (event.data.ok) void open(wanted.current)
      else setError(`Signing in to ${name} didn't work. Please try again.`)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [provider])

  function signIn() {
    const width = 600
    const height = 720
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2
    const popup = window.open(
      `/api/cloud/${provider}/connect`,
      `cloud-sign-in-${provider}`,
      `popup,width=${width},height=${height},left=${left},top=${top}`,
    )
    if (!popup) setError('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.')
  }

  if (needsSignIn) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-md border p-4">
        <p className="text-sm text-muted-foreground">
          Sign in to {name} to choose a folder. You'll stay signed in to it here for a few hours; nothing is kept after
          that.
        </p>
        <Button type="button" onClick={signIn}>
          <Icons.cloud />
          Sign in to {name}
        </Button>
        {error && <FieldError>{error}</FieldError>}
      </div>
    )
  }

  const crumbs = folder ? [...folder.parents, { id: folder.id, name: folder.name }] : []
  const folderPath = crumbs.slice(1).map((crumb) => crumb.name).join('/')

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <nav aria-label={`Folder in ${name}`} className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => (
          <span key={crumb.id || 'top'} className="flex items-center gap-1">
            {i > 0 && <Icons.chevronRight className="size-3.5 text-muted-foreground" />}
            {i === crumbs.length - 1 ? (
              <span className="font-medium">{crumb.name}</span>
            ) : (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => open(crumb.id)}
              >
                {crumb.name}
              </button>
            )}
          </span>
        ))}
        {loading && <Spinner className="ml-1 size-3.5 text-muted-foreground" />}
      </nav>
      {folder && (
        <>
          {folder.folders.length > 0 && (
            <ul className="flex max-h-56 flex-col overflow-y-auto">
              {folder.folders.map((child) => (
                <li key={child.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                    disabled={loading}
                    onClick={() => open(child.id)}
                  >
                    <Icons.folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{child.name}</span>
                    <Icons.chevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {folder.files.length === 0
                ? 'No audio or video in this folder.'
                : `${pluralise(folder.files.length, 'audio file')} in this folder.`}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={loading || folder.files.length === 0}
              onClick={() => onChoose(folder.files.map((file) => cloudUploadItem(provider, file, folderPath)))}
            >
              <Icons.add />
              Add this folder
            </Button>
          </div>
        </>
      )}
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}
