// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAbort, uploadFile } from '~/lib/upload'

// Records what's sent and lets each test play the server's part.
class FakeXhr {
  static last: FakeXhr
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
  onload?: () => void
  onerror?: () => void
  onabort?: () => void
  status = 0
  responseText = ''
  method?: string
  url?: string
  body?: unknown
  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  send(body: unknown) {
    this.body = body
  }
  abort() {
    this.onabort?.()
  }
  respond(status: number, text: string) {
    this.status = status
    this.responseText = text
    this.onload?.()
  }
}

const file = new File(['audio'], 'show.mp3', { type: 'audio/mpeg' })

beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeXhr))
afterEach(() => vi.unstubAllGlobals())

describe('uploadFile', () => {
  it('POSTs the file as the body and resolves with the JSON response', async () => {
    const { done } = uploadFile<{ uploadId: string }>('/api/uploads?filename=show.mp3', file)
    const xhr = FakeXhr.last
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/uploads?filename=show.mp3')
    expect(xhr.body).toBe(file)
    xhr.respond(200, '{"uploadId":"u1"}')
    await expect(done).resolves.toEqual({ uploadId: 'u1' })
  })

  it('reports progress as whole percentages when the size is known', () => {
    const onProgress = vi.fn()
    uploadFile('/api/uploads', file, onProgress)
    FakeXhr.last.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 3 })
    FakeXhr.last.upload.onprogress!({ lengthComputable: false, loaded: 2, total: 0 })
    expect(onProgress.mock.calls).toEqual([[33]])
  })

  it("rejects with the server's explanation for 4xx responses", async () => {
    const { done } = uploadFile('/api/uploads', file)
    FakeXhr.last.respond(415, "That file doesn't contain any audio we can read")
    await expect(done).rejects.toThrow("That file doesn't contain any audio we can read")
  })

  it('rejects with a generic message for server errors and empty 4xx bodies', async () => {
    const first = uploadFile('/api/uploads', file)
    FakeXhr.last.respond(500, 'stack trace')
    await expect(first.done).rejects.toThrow('Something went wrong uploading the file')
    const second = uploadFile('/api/uploads', file)
    FakeXhr.last.respond(413, '')
    await expect(second.done).rejects.toThrow('Something went wrong uploading the file')
  })

  it('rejects with a connection message on network errors', async () => {
    const { done } = uploadFile('/api/uploads', file)
    FakeXhr.last.onerror!()
    await expect(done).rejects.toThrow('The upload failed. Check your connection')
  })

  it('rejects with an AbortError when aborted', async () => {
    const { done, abort } = uploadFile('/api/uploads', file)
    abort()
    const error = await done.catch((e: unknown) => e)
    expect(isAbort(error)).toBe(true)
  })
})

describe('isAbort', () => {
  it('is only true for AbortError DOMExceptions', () => {
    expect(isAbort(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbort(new DOMException('x', 'NotFoundError'))).toBe(false)
    expect(isAbort(new Error('AbortError'))).toBe(false)
    expect(isAbort(null)).toBe(false)
  })
})
