// Sends a file as the raw request body to one of the upload endpoints
// (/api/uploads, /api/images). XHR rather than fetch, because fetch can't
// report upload progress.
export function uploadFile<T>(url: string, file: File, onProgress?: (percent: number) => void) {
  const xhr = new XMLHttpRequest()
  const done = new Promise<T>((resolve, reject) => {
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.floor((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status === 200) resolve(JSON.parse(xhr.responseText) as T)
      // 4xx responses explain what's wrong with the file; anything else is our fault.
      else if (xhr.status >= 400 && xhr.status < 500 && xhr.responseText) reject(new Error(xhr.responseText))
      else reject(new Error('Something went wrong uploading the file. Please try again.'))
    }
    xhr.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
  })
  xhr.open('POST', url)
  xhr.send(file)
  return { done, abort: () => xhr.abort() }
}

export function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
