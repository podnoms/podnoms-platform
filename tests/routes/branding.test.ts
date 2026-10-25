// The site's logo, icons and web manifest, and the admin endpoint that
// replaces the logo.
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultBranding } from '~/lib/branding'
import { Route as LogoRoute } from '~/routes/api/branding/logo'
import { Route as BrandRoute } from '~/routes/brand.$file'
import { Route as FaviconRoute } from '~/routes/favicon[.]ico'
import { Route as ManifestRoute } from '~/routes/site[.]webmanifest'
import { getSession } from '~/server/auth.server'
import { getBranding, resetLogo, saveBranding } from '~/server/branding.server'
import { resetDb } from '../db'
import { callRoute, createUser, db, makeImage } from '../helpers'

vi.mock('~/server/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/auth.server')>()),
  getSession: vi.fn(),
}))

beforeEach(() => resetDb(db))
afterEach(() => resetLogo())

const signIn = (id: string | null) =>
  vi.mocked(getSession).mockResolvedValue(id ? ({ user: { id }, expires: '' } as Awaited<ReturnType<typeof getSession>>) : null)

const brand = (file: string, query = '') =>
  callRoute(BrandRoute, 'GET', new Request(`http://localhost/brand/${file}${query}`), { file })

const upload = async (body: BodyInit) =>
  callRoute(LogoRoute, 'POST', new Request('http://localhost/api/branding/logo', { method: 'POST', body }))

describe('GET /brand/$file', () => {
  it('serves the logo at each icon size, and the preview card', async () => {
    for (const [file, width] of [['icon-16.png', 16], ['icon-180.png', 180], ['logo.png', 512], ['og.png', 1200]] as const) {
      const response = await brand(file)
      expect(response.headers.get('content-type')).toBe('image/png')
      expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width).toBe(width)
    }
  })

  it("is cached for good only when asked for with the current logo's version", async () => {
    expect((await brand('icon-32.png')).headers.get('cache-control')).toBe('public, max-age=300')
    expect((await brand('icon-32.png', '?v=default')).headers.get('cache-control')).toContain('immutable')
  })

  it('knows no other files', async () => {
    expect((await brand('icon-33.png')).status).toBe(404)
    expect((await brand('other.png')).status).toBe(404)
  })
})

describe('GET /favicon.ico', () => {
  it('is the 32px icon', async () => {
    const response = await callRoute(FaviconRoute, 'GET', new Request('http://localhost/favicon.ico'))
    expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width).toBe(32)
  })
})

describe('GET /site.webmanifest', () => {
  afterEach(() => saveBranding({ ...defaultBranding, landing: null, analyticsScriptUrl: null, analyticsAttributes: {} }))

  it('names the site and points at its current icons', async () => {
    await saveBranding({ ...defaultBranding, name: 'Pods', landing: null, analyticsScriptUrl: null, analyticsAttributes: {} })
    const response = await callRoute(ManifestRoute, 'GET', new Request('http://localhost/site.webmanifest'))
    expect(response.headers.get('content-type')).toBe('application/manifest+json')
    expect(await response.json()).toMatchObject({
      name: 'Pods',
      icons: [
        { src: '/brand/icon-192.png', sizes: '192x192' },
        { src: '/brand/icon-512.png', sizes: '512x512' },
      ],
    })
  })
})

describe('/api/branding/logo', () => {
  it('is for admins only', async () => {
    signIn(null)
    expect((await upload(await makeImage(64, 64))).status).toBe(401)
    const user = await createUser({ isAdmin: false })
    signIn(user.id)
    expect((await upload(await makeImage(64, 64))).status).toBe(403)
    expect((await getBranding()).logoVersion).toBeNull()
  })

  it("replaces the logo, whose icons' URLs then change", async () => {
    const admin = await createUser({ isAdmin: true })
    signIn(admin.id)
    const response = await upload(await makeImage(600, 600))
    const { logoVersion } = (await response.json()) as { logoVersion: string }
    expect((await getBranding()).logoVersion).toBe(logoVersion)
    expect((await brand('icon-32.png', `?v=${logoVersion}`)).headers.get('cache-control')).toContain('immutable')

    const reset = await callRoute(LogoRoute, 'DELETE', new Request('http://localhost/api/branding/logo', { method: 'DELETE' }))
    expect(reset.status).toBe(204)
    expect((await getBranding()).logoVersion).toBeNull()
  })

  it('explains what is wrong with a file that is not an image', async () => {
    const admin = await createUser({ isAdmin: true })
    signIn(admin.id)
    const response = await upload('nope')
    expect(response.status).toBe(415)
    expect(await response.text()).toMatch(/isn't an image/)
  })
})
