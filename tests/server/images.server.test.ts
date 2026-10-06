import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { episodes, podcasts } from '~/server/db/schema'
import {
  commitImage,
  convertToArtwork,
  deleteImage,
  downloadImage,
  imageVariant,
  localiseRemoteImages,
  openGraphImage,
  stageImage,
} from '~/server/images.server'
import { ensureImageVariantsDir, imagePath, imageVariantPath, openGraphImagePath, stagedImagePath } from '~/server/storage.server'
import { resetDb } from '../db'
import {
  createEpisode,
  createPodcast,
  createUser,
  db,
  exists,
  hasFfmpeg,
  makeImage,
  stageTestImage,
  storeTestImage,
  streamOf,
} from '../helpers'

const dir = join(process.env.MEDIA_DIR!, 'images-test')

beforeAll(() => mkdir(dir, { recursive: true }))

describe('convertToArtwork', () => {
  it('scales small images up to 1400px squares', async () => {
    const source = join(dir, 'small.png')
    await writeFile(source, await makeImage(300, 200))
    await convertToArtwork(source, join(dir, 'small.jpg'))
    expect(await sharp(join(dir, 'small.jpg')).metadata()).toMatchObject({ format: 'jpeg', width: 1400, height: 1400 })
  })

  it('crops large images to a square no bigger than 3000px', async () => {
    const source = join(dir, 'large.png')
    await writeFile(source, await makeImage(4000, 3500))
    await convertToArtwork(source, join(dir, 'large.jpg'))
    expect(await sharp(join(dir, 'large.jpg')).metadata()).toMatchObject({ width: 3000, height: 3000 })
  })

  it('keeps mid-sized images at their shorter side', async () => {
    const source = join(dir, 'mid.png')
    await writeFile(source, await makeImage(2000, 1600))
    await convertToArtwork(source, join(dir, 'mid.jpg'))
    expect(await sharp(join(dir, 'mid.jpg')).metadata()).toMatchObject({ width: 1600, height: 1600 })
  })

  it('puts transparent images on white', async () => {
    const source = join(dir, 'clear.png')
    await writeFile(
      source,
      await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(),
    )
    await convertToArtwork(source, join(dir, 'clear.jpg'))
    const { channels } = await sharp(join(dir, 'clear.jpg')).stats()
    expect(channels[0]!.mean).toBeGreaterThan(250)
  })

  it('throws for files that are not images', async () => {
    const source = join(dir, 'text.png')
    await writeFile(source, 'not an image')
    await expect(convertToArtwork(source, join(dir, 'text.jpg'))).rejects.toThrow()
    expect(await exists(`${source}.png`)).toBe(false)
  })

  it.skipIf(!hasFfmpeg)('decodes formats sharp cannot read with ffmpeg', async () => {
    const source = join(dir, 'frame.bmp')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', source])
    await convertToArtwork(source, join(dir, 'frame.jpg'))
    expect(await sharp(join(dir, 'frame.jpg')).metadata()).toMatchObject({ width: 1400, height: 1400 })
    expect(await exists(`${source}.png`)).toBe(false)
  })
})

describe('stageImage / commitImage', () => {
  it('converts and stages an upload, then commits it to the image store', async () => {
    const { imageId } = await stageImage('user-1', streamOf(await makeImage(50, 50)))
    expect(await exists(stagedImagePath('user-1', imageId))).toBe(true)
    expect(await readdir(join(process.env.MEDIA_DIR!, 'staged-images', 'user-1'))).toEqual([`${imageId}.jpg`])

    expect(await commitImage('user-1', imageId)).toBe(`/images/${imageId}.jpg`)
    expect(await exists(imagePath(imageId))).toBe(true)
    expect(await exists(stagedImagePath('user-1', imageId))).toBe(false)
  })

  it('refuses uploads that are not images with 415', async () => {
    await expect(stageImage('user-1', streamOf('nope'))).rejects.toMatchObject({ status: 415 })
  })

  it("can't commit another user's staged image", async () => {
    const imageId = await stageTestImage('owner')
    await expect(commitImage('thief', imageId)).rejects.toThrow('That image has expired')
    expect(await exists(stagedImagePath('owner', imageId))).toBe(true)
  })
})

describe('deleteImage', () => {
  it('removes a stored image and its variants', async () => {
    const image = await storeTestImage()
    const variants = await ensureImageVariantsDir()
    await writeFile(imageVariantPath(image.imageId, 64, 'jpg'), 'x')
    await writeFile(imageVariantPath(image.imageId, 128, 'webp'), 'x')
    await writeFile(openGraphImagePath(image.imageId), 'x')
    const other = await storeTestImage()
    await writeFile(imageVariantPath(other.imageId, 64, 'jpg'), 'x')

    await deleteImage(image.url)
    expect(await exists(image.path)).toBe(false)
    const left = await readdir(variants)
    expect(left.some((name) => name.startsWith(image.imageId))).toBe(false)
    expect(left).toContain(`${other.imageId}-64.jpg`)
  })

  it('ignores remote, missing and malformed URLs', async () => {
    await expect(deleteImage(null)).resolves.toBeUndefined()
    await expect(deleteImage('https://i.ytimg.com/x.jpg')).resolves.toBeUndefined()
    await expect(deleteImage('/images/../../etc/passwd.jpg')).resolves.toBeUndefined()
  })
})

describe('imageVariant', () => {
  it('returns null for images that do not exist', async () => {
    expect(await imageVariant(crypto.randomUUID(), 64, 'jpg')).toBeNull()
  })

  it('rounds the width up to a kept size and makes the copy once', async () => {
    const image = await storeTestImage()
    const variant = await imageVariant(image.imageId, 100, 'webp')
    expect(variant).toEqual({ path: imageVariantPath(image.imageId, 128, 'webp'), format: 'webp' })
    expect(await sharp(variant!.path).metadata()).toMatchObject({ format: 'webp', width: 128, height: 128 })
    expect(await imageVariant(image.imageId, 128, 'webp')).toEqual(variant)
  })

  it('serves the original beyond the largest kept width', async () => {
    const image = await storeTestImage()
    expect(await imageVariant(image.imageId, 5000, 'webp')).toEqual({ path: image.path, format: 'jpg' })
    expect(await imageVariant(image.imageId, Infinity, 'jpg')).toEqual({ path: image.path, format: 'jpg' })
  })

  it('shares the work between simultaneous requests and leaves no partial files', async () => {
    const image = await storeTestImage()
    const results = await Promise.all([1, 2, 3].map(() => imageVariant(image.imageId, 64, 'jpg')))
    expect(new Set(results.map((r) => r!.path)).size).toBe(1)
    const variants = await readdir(await ensureImageVariantsDir())
    expect(variants.filter((name) => name.includes('.partial'))).toEqual([])
  })
})

describe('openGraphImage', () => {
  it('returns null for images that do not exist', async () => {
    expect(await openGraphImage(crypto.randomUUID())).toBeNull()
  })

  it('makes a 1200×630 JPEG once', async () => {
    const image = await storeTestImage()
    const path = await openGraphImage(image.imageId)
    expect(path).toBe(openGraphImagePath(image.imageId))
    expect(await sharp(path!).metadata()).toMatchObject({ format: 'jpeg', width: 1200, height: 630 })
    expect(await openGraphImage(image.imageId)).toBe(path)
  })
})

describe('downloadImage / localiseRemoteImages', () => {
  let server: Server
  let base: string

  beforeAll(async () => {
    const png = await makeImage(40, 40)
    server = createServer((request, response) => {
      if (request.url === '/art.png') response.end(png)
      else if (request.url === '/text') response.end('not an image')
      else response.writeHead(404).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
  beforeEach(() => resetDb(db))

  it('stores a remote image as artwork', async () => {
    const url = await downloadImage(`${base}/art.png`)
    expect(url).toMatch(/^\/images\/[0-9a-f-]{36}\.jpg$/)
    const imageId = url!.slice('/images/'.length, -'.jpg'.length)
    expect(await sharp(imagePath(imageId)).metadata()).toMatchObject({ width: 1400 })
  })

  it('returns null for errors, non-images and unreachable hosts', async () => {
    expect(await downloadImage(`${base}/missing`)).toBeNull()
    expect(await downloadImage(`${base}/text`)).toBeNull()
    expect(await downloadImage('http://127.0.0.1:1/x.png')).toBeNull()
  })

  it('replaces remote artwork links with stored copies, leaving broken ones', async () => {
    const user = await createUser()
    const podcast = await createPodcast(user.id, { imageUrl: `${base}/art.png` })
    const broken = await createPodcast(user.id, { imageUrl: `${base}/missing` })
    const episode = await createEpisode(podcast.id, { imageUrl: `${base}/art.png` })
    await localiseRemoteImages()
    const [p] = await db.select().from(podcasts).where(eq(podcasts.id, podcast.id))
    const [b] = await db.select().from(podcasts).where(eq(podcasts.id, broken.id))
    const [e] = await db.select().from(episodes).where(eq(episodes.id, episode.id))
    expect(p!.imageUrl).toMatch(/^\/images\//)
    expect(e!.imageUrl).toMatch(/^\/images\//)
    expect(b!.imageUrl).toBe(`${base}/missing`)
  })
})
