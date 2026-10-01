// The upload endpoints, which take the raw file as the request body.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as ImagesRoute } from '~/routes/api/images'
import { Route as UploadsRoute } from '~/routes/api/uploads'
import { getSession } from '~/server/auth.server'
import { findUpload } from '~/server/uploads.server'
import { callRoute, hasFfmpeg, makeImage, makeTone } from '../helpers'

vi.mock('~/server/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/auth.server')>()),
  getSession: vi.fn(),
}))

const signedIn = () => vi.mocked(getSession).mockResolvedValue({ user: { id: 'user-1' }, expires: '' })

beforeEach(() => vi.mocked(getSession).mockResolvedValue(null))

function post(path: string, body?: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`http://x${path}`, { method: 'POST', body, headers, duplex: 'half' } as RequestInit)
}

describe('POST /api/uploads', () => {
  it('is 401 when signed out', async () => {
    const response = await callRoute(UploadsRoute, 'POST', post('/api/uploads', 'x'))
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('You need to be signed in')
  })

  it('is 400 without a body', async () => {
    signedIn()
    expect((await callRoute(UploadsRoute, 'POST', post('/api/uploads'))).status).toBe(400)
  })

  it('refuses files over 1 GB by their declared length', async () => {
    signedIn()
    const response = await callRoute(UploadsRoute, 'POST', post('/api/uploads', 'x', { 'content-length': String(2 * 1024 ** 3) }))
    expect(response.status).toBe(413)
  })

  it('explains files it cannot read as audio', async () => {
    signedIn()
    const response = await callRoute(UploadsRoute, 'POST', post('/api/uploads?filename=a.mp3', 'not audio'))
    expect(response.status).toBe(415)
    expect(await response.text()).toBe("That file doesn't contain any audio we can read")
  })

  it.skipIf(!hasFfmpeg)('stages audio for the signed-in user, titled by its file name', async () => {
    signedIn()
    const tone = await makeTone(join(process.env.MEDIA_DIR!, 'route-upload.wav'), 1)
    const response = await callRoute(
      UploadsRoute,
      'POST',
      post(`/api/uploads?filename=${encodeURIComponent('Morning Show.wav')}`, await readFile(tone)),
    )
    expect(response.status).toBe(200)
    const upload = (await response.json()) as { uploadId: string }
    expect(upload).toEqual({ uploadId: expect.any(String), title: 'Morning Show', durationSeconds: 1 })
    expect(await findUpload('user-1', upload.uploadId)).toEqual(upload)
  })
})

describe('POST /api/images', () => {
  it('is 401 when signed out', async () => {
    expect((await callRoute(ImagesRoute, 'POST', post('/api/images', 'x'))).status).toBe(401)
  })

  it('is 400 without a body', async () => {
    signedIn()
    expect((await callRoute(ImagesRoute, 'POST', post('/api/images'))).status).toBe(400)
  })

  it('refuses images over 20 MB by their declared length', async () => {
    signedIn()
    const response = await callRoute(ImagesRoute, 'POST', post('/api/images', 'x', { 'content-length': String(21 * 1024 * 1024) }))
    expect(response.status).toBe(413)
  })

  it('refuses images over 20 MB that under-declare their length', async () => {
    signedIn()
    const response = await callRoute(ImagesRoute, 'POST', post('/api/images', new Uint8Array(20 * 1024 * 1024 + 1)))
    expect(response.status).toBe(413)
    expect(await response.text()).toBe('That file is too big to upload')
  })

  it('explains files that are not images', async () => {
    signedIn()
    const response = await callRoute(ImagesRoute, 'POST', post('/api/images', 'not an image'))
    expect(response.status).toBe(415)
  })

  it('stages an image and returns its ID', async () => {
    signedIn()
    const response = await callRoute(ImagesRoute, 'POST', post('/api/images', await makeImage(20, 20)))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ imageId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
  })
})
