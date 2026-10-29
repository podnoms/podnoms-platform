import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultImageModerationLimits } from '~/lib/image-moderation'
import { contentSafety, moderateImage, ModerationUnavailableError } from '~/server/image-moderation.server'
import { downloadImage, ImageRejectedError, stageImage } from '~/server/images.server'
import { listNotifications } from '~/server/inbox.server'
import { updateSiteSettings } from '~/server/site-settings.server'
import { resetDb } from '../db'
import { createUser, db, makeImage, streamOf } from '../helpers'

vi.mock('~/server/email.server', () => ({
  emailEnabled: async () => false,
  emailOrigin: () => null,
  sendEmail: vi.fn(),
}))

const endpoint = 'https://safety.example.cognitiveservices.azure.com/'
const realFetch = globalThis.fetch

// What Azure says about the next images, by category; null to fail.
let ratings: Record<string, number> | null
const requests: { url: string; headers: Headers; body: { image: { content: string }; categories: string[] } }[] = []

const dir = join(process.env.MEDIA_DIR!, 'moderation-test')
beforeAll(() => mkdir(dir, { recursive: true }))

beforeEach(async () => {
  await resetDb(db)
  // resetDb keeps settings; each test starts with the default limits.
  await updateSiteSettings({ imageModeration: defaultImageModerationLimits })
  contentSafety.endpoint = endpoint
  contentSafety.key = 'azure-key'
  ratings = {}
  requests.length = 0
  // Azure is stood in for; anything else (the test image server) is fetched for real.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (!url.startsWith(endpoint)) return realFetch(input, init)
      requests.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
      if (!ratings) return new Response('Server error', { status: 500 })
      return Response.json({
        categoriesAnalysis: ['Hate', 'SelfHarm', 'Sexual', 'Violence'].map((category) => ({
          category,
          severity: ratings![category] ?? 0,
        })),
      })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

async function artwork(name: string, width = 1400, height = 1400) {
  const path = join(dir, name)
  await writeFile(path, await makeImage(width, height, 'jpeg'))
  return path
}

describe('moderateImage', () => {
  it('sends Azure a copy no bigger than 1024px, with the key', async () => {
    expect(await moderateImage(await artwork('big.jpg', 3000, 2000))).toEqual({ allowed: true })
    const [request] = requests
    expect(request!.url).toBe(`${endpoint}contentsafety/image:analyze?api-version=2024-09-01`)
    expect(request!.headers.get('ocp-apim-subscription-key')).toBe('azure-key')
    expect(request!.body.categories).toEqual(['Sexual', 'Violence', 'Hate', 'SelfHarm'])
    const sent = await sharp(Buffer.from(request!.body.image.content, 'base64')).metadata()
    expect(sent).toMatchObject({ format: 'jpeg', width: 1024, height: 683 })
  })

  it('refuses images over the default, family-friendly limits', async () => {
    const path = await artwork('art.jpg')
    ratings = { Sexual: 2 }
    expect(await moderateImage(path)).toEqual({ allowed: false, category: 'sexual', severity: 2 })
    ratings = { Violence: 2 }
    expect(await moderateImage(path)).toEqual({ allowed: true })
    ratings = { Violence: 4, Hate: 6 }
    expect(await moderateImage(path)).toEqual({ allowed: false, category: 'hate', severity: 6 })
  })

  it('uses the limits admins set', async () => {
    const path = await artwork('art.jpg')
    await updateSiteSettings({ imageModeration: { sexual: 2, violence: 6, hate: 0, selfHarm: 0 } })
    ratings = { Sexual: 2, Violence: 6 }
    expect(await moderateImage(path)).toEqual({ allowed: true })
    ratings = { Sexual: 4 }
    expect(await moderateImage(path)).toMatchObject({ allowed: false, category: 'sexual' })
  })

  it("throws when Azure can't be reached", async () => {
    ratings = null
    await expect(moderateImage(await artwork('art.jpg'))).rejects.toBeInstanceOf(ModerationUnavailableError)
  })

  it("allows everything, without asking, when it isn't set up", async () => {
    contentSafety.key = undefined
    ratings = { Sexual: 6 }
    expect(await moderateImage(await artwork('art.jpg'))).toEqual({ allowed: true })
    expect(requests).toEqual([])
  })
})

describe('stageImage', () => {
  it('stages allowed images', async () => {
    const { imageId } = await stageImage('user-1', streamOf(await makeImage(50, 50)))
    expect(imageId).toBeTruthy()
    expect(requests).toHaveLength(1)
  })

  it('refuses unsuitable images with 422, keeping nothing', async () => {
    const user = await createUser()
    ratings = { Sexual: 4 }
    const staging = stageImage(user.id, streamOf(await makeImage(50, 50)))
    await expect(staging).rejects.toBeInstanceOf(ImageRejectedError)
    await expect(staging).rejects.toMatchObject({ status: 422 })
    expect(await readdir(join(process.env.MEDIA_DIR!, 'staged-images', user.id))).toEqual([])
  })

  it("refuses with 503 when images can't be checked", async () => {
    ratings = null
    await expect(stageImage('user-1', streamOf(await makeImage(50, 50)))).rejects.toMatchObject({ status: 503 })
  })

  it('tells admins when someone tries an explicit image', async () => {
    const admin = await createUser({ isAdmin: true })
    const user = await createUser({ name: 'Sam', email: 'sam@example.com' })
    ratings = { Sexual: 6 }
    await expect(stageImage(user.id, streamOf(await makeImage(50, 50)))).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const { items } = await listNotifications(admin.id)
    expect(items).toMatchObject([{ kind: 'blockedImage', body: 'Sam (sam@example.com) tried to use it.' }])
  })
})

describe('downloadImage', () => {
  let server: Server
  let base: string
  beforeAll(async () => {
    const image = await makeImage(50, 50)
    server = createServer((_request, response) => response.end(image))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('keeps allowed images', async () => {
    expect(await downloadImage(`${base}/thumb.png`)).toMatch(/^\/images\/.+\.jpg$/)
  })

  it("leaves out refused images, and ones that can't be checked", async () => {
    const images = join(process.env.MEDIA_DIR!, 'images')
    const before = await readdir(images).catch(() => [])
    ratings = { Sexual: 2 }
    expect(await downloadImage(`${base}/thumb.png`)).toBeNull()
    ratings = null
    expect(await downloadImage(`${base}/thumb.png`)).toBeNull()
    expect(await readdir(images)).toEqual(before)
  })
})
