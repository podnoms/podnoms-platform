import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findUpload } from '~/server/uploads.server'
import { hasFfmpeg, makeTone } from '../helpers'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// Loads the module afresh with both providers set up, as src/env.ts reads them once.
async function load(configured = true) {
  vi.resetModules()
  if (configured) {
    vi.stubEnv('DROPBOX_APP_KEY', 'dropbox-key')
    vi.stubEnv('DROPBOX_APP_SECRET', 'dropbox-secret')
    vi.stubEnv('BOX_CLIENT_ID', 'box-id')
    vi.stubEnv('BOX_CLIENT_SECRET', 'box-secret')
  }
  return import('~/server/cloud-storage.server')
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

// Answers the token endpoints, and everything else with the handler.
function stubFetch(handler: Handler) {
  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: `token-for-${new URL(url).host}`, expires_in: 3600 })
    return handler(url, init)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const origin = 'https://podnoms.test'

// Signs the user in to the provider, as the popup's round trip does.
async function connect(module: Awaited<ReturnType<typeof load>>, userId: string, provider: 'dropbox' | 'box') {
  const state = new URL(module.cloudAuthorizeUrl(userId, provider, origin)).searchParams.get('state')
  expect(await module.connectCloud({ userId, provider, state, code: 'code', origin })).toBe(true)
}

describe('enabledCloudProviders', () => {
  it('lists the providers with both of their values set', async () => {
    expect((await load(false)).enabledCloudProviders()).toEqual([])
    expect((await load()).enabledCloudProviders()).toEqual(['dropbox', 'box'])
  })
})

describe('signing in', () => {
  it('sends the user to the provider with our callback', async () => {
    const { cloudAuthorizeUrl } = await load()
    const url = new URL(cloudAuthorizeUrl('user-1', 'dropbox', origin))
    expect(url.origin).toBe('https://www.dropbox.com')
    expect(url.searchParams.get('client_id')).toBe('dropbox-key')
    expect(url.searchParams.get('redirect_uri')).toBe(`${origin}/api/cloud/dropbox/callback`)
    expect(url.searchParams.get('token_access_type')).toBe('online')
    expect(new URL(cloudAuthorizeUrl('user-1', 'box', origin)).origin).toBe('https://account.box.com')
  })

  it("refuses a state that isn't the user's, or is used twice", async () => {
    const module = await load()
    const fetch = stubFetch(() => new Response(null, { status: 500 }))
    const state = new URL(module.cloudAuthorizeUrl('user-1', 'box', origin)).searchParams.get('state')
    expect(await module.connectCloud({ userId: 'user-2', provider: 'box', state, code: 'code', origin })).toBe(false)
    // Taken by the first try.
    expect(await module.connectCloud({ userId: 'user-1', provider: 'box', state, code: 'code', origin })).toBe(false)
    expect(await module.connectCloud({ userId: 'user-1', provider: 'box', state: 'made-up', code: 'code', origin })).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('needs signing in before a folder can be listed', async () => {
    const module = await load()
    stubFetch(() => Response.json({}))
    await expect(module.listCloudFolder('user-1', 'dropbox')).rejects.toBeInstanceOf(module.CloudNotConnectedError)
  })

  it('forgets a token the provider refuses', async () => {
    const module = await load()
    stubFetch(() => new Response('expired', { status: 401 }))
    await connect(module, 'user-1', 'box')
    await expect(module.listCloudFolder('user-1', 'box')).rejects.toBeInstanceOf(module.CloudNotConnectedError)
    stubFetch(() => Response.json({}))
    await expect(module.listCloudFolder('user-1', 'box')).rejects.toBeInstanceOf(module.CloudNotConnectedError)
  })
})

describe('listCloudFolder', () => {
  it("lists a Dropbox folder's subfolders and audio, page by page, in name order", async () => {
    const module = await load()
    const fetch = stubFetch((url, init) => {
      const body = JSON.parse(String(init.body))
      if (url.endsWith('/list_folder')) {
        expect(body.path).toBe('/Shows/Old Mixes')
        return Response.json({
          entries: [
            { '.tag': 'file', id: 'id:b', name: 'Mix 10.mp3', size: 10 },
            { '.tag': 'file', id: 'id:c', name: 'cover.jpg', size: 5 },
            { '.tag': 'folder', id: 'id:f', name: 'Extras', path_display: '/Shows/Old Mixes/Extras' },
          ],
          cursor: 'next',
          has_more: true,
        })
      }
      expect(body.cursor).toBe('next')
      return Response.json({
        entries: [{ '.tag': 'file', id: 'id:a', name: 'Mix 9.flac', size: 9 }],
        cursor: 'end',
        has_more: false,
      })
    })
    await connect(module, 'user-1', 'dropbox')
    const folder = await module.listCloudFolder('user-1', 'dropbox', '/Shows/Old Mixes')
    expect(folder).toEqual({
      id: '/Shows/Old Mixes',
      name: 'Old Mixes',
      parents: [
        { id: '', name: 'Dropbox' },
        { id: '/Shows', name: 'Shows' },
      ],
      folders: [{ id: '/Shows/Old Mixes/Extras', name: 'Extras' }],
      files: [
        { id: 'id:a', name: 'Mix 9.flac', size: 9 },
        { id: 'id:b', name: 'Mix 10.mp3', size: 10 },
      ],
    })
    expect(fetch.mock.calls.at(-1)![1]!.headers).toMatchObject({ Authorization: 'Bearer token-for-api.dropboxapi.com' })
  })

  it('lists the top of Dropbox without a folder', async () => {
    const module = await load()
    stubFetch(() => Response.json({ entries: [], cursor: 'end', has_more: false }))
    await connect(module, 'user-1', 'dropbox')
    expect(await module.listCloudFolder('user-1', 'dropbox')).toMatchObject({ id: '', name: 'Dropbox', parents: [] })
  })

  it('lists a Box folder with the folders above it', async () => {
    const module = await load()
    stubFetch((url) => {
      if (url.includes('/items?')) {
        const offset = Number(new URL(url).searchParams.get('offset'))
        return Response.json({
          total_count: 2,
          entries:
            offset === 0
              ? [{ type: 'file', id: '2', name: 'Episode 1.m4a', size: 100 }]
              : [{ type: 'folder', id: '3', name: 'Raw' }],
        })
      }
      expect(url).toContain('/folders/42?')
      return Response.json({
        id: '42',
        name: 'Podcast',
        path_collection: { entries: [{ id: '0', name: 'All Files' }] },
      })
    })
    await connect(module, 'user-1', 'box')
    expect(await module.listCloudFolder('user-1', 'box', '42')).toEqual({
      id: '42',
      name: 'Podcast',
      parents: [{ id: '0', name: 'All Files' }],
      folders: [{ id: '3', name: 'Raw' }],
      files: [{ id: '2', name: 'Episode 1.m4a', size: 100 }],
    })
  })

  it("keeps each user's sign-in to themselves", async () => {
    const module = await load()
    stubFetch(() => Response.json({ entries: [], cursor: 'end', has_more: false }))
    await connect(module, 'user-1', 'dropbox')
    await expect(module.listCloudFolder('user-2', 'dropbox')).rejects.toBeInstanceOf(module.CloudNotConnectedError)
  })
})

describe.skipIf(!hasFfmpeg)('importCloudFile', () => {
  it('copies the file into the user\'s uploads, as if uploaded', async () => {
    const module = await load()
    const tone = join(process.env.MEDIA_DIR!, 'cloud-tone.mp3')
    await makeTone(tone)
    const audio = await readFile(tone)
    const fetch = stubFetch(() => new Response(audio))
    await connect(module, 'user-1', 'dropbox')
    const upload = await module.importCloudFile('user-1', 'dropbox', 'id:abc', 'Folder/My Mix.mp3')
    expect(upload).toMatchObject({ title: 'My Mix' })
    expect(await findUpload('user-1', upload.uploadId)).toEqual(upload)
    const [url, init] = fetch.mock.calls.at(-1)!
    expect(String(url)).toBe('https://content.dropboxapi.com/2/files/download')
    expect(init!.headers).toMatchObject({ 'Dropbox-API-Arg': '{"path":"id:abc"}' })
  })

  it('refuses files over the upload limit before copying them', async () => {
    const module = await load()
    stubFetch(() => new Response('x', { headers: { 'Content-Length': String(100 * 1024 ** 4) } }))
    await connect(module, 'user-1', 'box')
    await expect(module.importCloudFile('user-1', 'box', '7', 'big.wav')).rejects.toMatchObject({ status: 413 })
  })
})
