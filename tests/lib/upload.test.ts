// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAbort, uploadFile, uploadFileInParts } from '~/lib/upload'

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

  it("reports progress as whole percentages of the file's size", () => {
    const onProgress = vi.fn()
    uploadFile('/api/uploads', new File(['abc'], 'show.mp3'), onProgress)
    FakeXhr.last.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 3 })
    FakeXhr.last.upload.onprogress!({ lengthComputable: false, loaded: 2, total: 0 })
    expect(onProgress.mock.calls).toEqual([[33], [66]])
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

describe('uploadFileInParts', () => {
  const tenBytes = new File(['0123456789'], 'My Show.mp3')
  // Lets pending awaits (and retry delays, with fake timers) run.
  const settle = () => vi.advanceTimersByTimeAsync(5000)

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  async function bodyText(xhr: FakeXhr) {
    return (xhr.body as Blob).text()
  }

  it('sends the file in order, passing on the upload ID, and resolves with the last response', async () => {
    const { done } = uploadFileInParts<{ title: string }>(tenBytes, undefined, 4)

    const first = FakeXhr.last
    expect(first.url).toBe('/api/uploads?filename=My+Show.mp3&size=10&offset=0')
    expect(await bodyText(first)).toBe('0123')
    first.respond(200, '{"uploadId":"u1","received":4}')
    await settle()

    const second = FakeXhr.last
    expect(second.url).toBe('/api/uploads?filename=My+Show.mp3&size=10&offset=4&uploadId=u1')
    expect(await bodyText(second)).toBe('4567')
    second.respond(200, '{"uploadId":"u1","received":8}')
    await settle()

    const last = FakeXhr.last
    expect(last.url).toContain('offset=8&uploadId=u1')
    expect(await bodyText(last)).toBe('89')
    last.respond(200, '{"uploadId":"u1","title":"My Show"}')
    await expect(done).resolves.toEqual({ uploadId: 'u1', title: 'My Show' })
  })

  it('reports progress across the whole file', async () => {
    const onProgress = vi.fn()
    uploadFileInParts(tenBytes, onProgress, 5)
    FakeXhr.last.upload.onprogress!({ lengthComputable: true, loaded: 5, total: 5 })
    FakeXhr.last.respond(200, '{"uploadId":"u1","received":5}')
    await settle()
    FakeXhr.last.upload.onprogress!({ lengthComputable: true, loaded: 2, total: 5 })
    expect(onProgress.mock.calls).toEqual([[50], [70]])
  })

  it('sends a part again after a network or server error', async () => {
    const { done } = uploadFileInParts(tenBytes, undefined, 10)
    FakeXhr.last.onerror!()
    await settle()
    FakeXhr.last.respond(502, '')
    await settle()
    const third = FakeXhr.last
    expect(third.url).toContain('offset=0')
    third.respond(200, '{"uploadId":"u1","title":"t"}')
    await expect(done).resolves.toEqual({ uploadId: 'u1', title: 't' })
  })

  it('gives up after three attempts at a part', async () => {
    const { done } = uploadFileInParts(tenBytes, undefined, 10)
    const result = done.catch((e: unknown) => e)
    for (let i = 0; i < 3; i++) {
      FakeXhr.last.onerror!()
      await settle()
    }
    expect(await result).toMatchObject({ message: expect.stringContaining('Check your connection') })
  })

  it("doesn't send a part again when the server explains what's wrong", async () => {
    const { done } = uploadFileInParts(tenBytes, undefined, 10)
    const sent = FakeXhr.last
    FakeXhr.last.respond(415, "That file doesn't contain any audio we can read")
    await expect(done).rejects.toThrow("That file doesn't contain any audio we can read")
    expect(FakeXhr.last).toBe(sent)
  })

  it('stops when aborted', async () => {
    const { done, abort } = uploadFileInParts(tenBytes, undefined, 4)
    FakeXhr.last.respond(200, '{"uploadId":"u1","received":4}')
    await settle()
    const sent = FakeXhr.last
    abort()
    expect(isAbort(await done.catch((e: unknown) => e))).toBe(true)
    await settle()
    expect(FakeXhr.last).toBe(sent)
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
