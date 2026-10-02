// Sends files as the raw request body to the upload endpoints (/api/uploads,
// /api/images). XHR rather than fetch, because fetch can't report upload
// progress.

// Failures that sending the same thing again might fix: lost connections and
// server errors, rather than the server explaining what's wrong with the file.
class UploadFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

function send<T>(url: string, body: Blob, onProgress?: (loaded: number) => void) {
  const xhr = new XMLHttpRequest()
  const done = new Promise<T>((resolve, reject) => {
    xhr.upload.onprogress = (event) => onProgress?.(event.loaded)
    xhr.onload = () => {
      if (xhr.status === 200) resolve(JSON.parse(xhr.responseText) as T)
      // 4xx responses explain what's wrong with the file; anything else is our fault.
      else if (xhr.status >= 400 && xhr.status < 500 && xhr.responseText) reject(new UploadFailure(xhr.responseText, false))
      else reject(new UploadFailure('Something went wrong uploading the file. Please try again.', xhr.status >= 500))
    }
    xhr.onerror = () => reject(new UploadFailure('The upload failed. Check your connection and try again.', true))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
  })
  xhr.open('POST', url)
  xhr.send(body)
  return { done, abort: () => xhr.abort() }
}

const percentOf = (loaded: number, total: number) => (total > 0 ? Math.min(100, Math.floor((loaded / total) * 100)) : 0)

// Sends the whole file in one request.
export function uploadFile<T>(url: string, file: File, onProgress?: (percent: number) => void) {
  return send<T>(url, file, (loaded) => onProgress?.(percentOf(loaded, file.size)))
}

// Production sits behind Cloudflare, which refuses request bodies over 100 MB.
export const uploadPartBytes = 50 * 1024 * 1024
const attemptsPerPart = 3

// Sends the file to /api/uploads in parts of uploadPartBytes, so large files
// get past Cloudflare, sending a part again if its request fails along the way.
// Resolves with the response to the last part.
export function uploadFileInParts<T>(file: File, onProgress?: (percent: number) => void, partBytes = uploadPartBytes) {
  let current: { abort: () => void } | null = null
  let aborted = false

  async function run() {
    let uploadId = ''
    let offset = 0
    for (;;) {
      const end = Math.min(offset + partBytes, file.size)
      const params = new URLSearchParams({ filename: file.name, size: String(file.size), offset: String(offset) })
      if (uploadId) params.set('uploadId', uploadId)
      for (let attempt = 1; ; attempt++) {
        if (aborted) throw new DOMException('Upload cancelled', 'AbortError')
        const request = send<T & { uploadId: string; received?: number }>(
          `/api/uploads?${params}`,
          file.slice(offset, end),
          (loaded) => onProgress?.(percentOf(offset + loaded, file.size)),
        )
        current = request
        try {
          const response = await request.done
          if (end >= file.size) return response as T
          uploadId = response.uploadId
          offset = response.received ?? end
          break
        } catch (error) {
          if (!(error instanceof UploadFailure && error.retryable) || attempt >= attemptsPerPart) throw error
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
  }

  return {
    done: run(),
    abort: () => {
      aborted = true
      current?.abort()
    },
  }
}

export function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
