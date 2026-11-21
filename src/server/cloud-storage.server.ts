// Uploading a folder of audio from Dropbox or Box. The user signs in to the
// provider in a popup (OAuth, through /api/cloud/$provider/connect and
// callback), browses to a folder in the bulk upload dialog, and each of its
// audio files is copied from the provider straight into the user's staged
// uploads (saveUpload), as if they'd uploaded it, so it becomes an episode the
// same way. Providers' access tokens are only kept in memory, for as long as
// they last (hours), never stored.
import '@tanstack/react-start/server-only'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { env } from '~/env'
import { byFileName, isAudioFileName } from '~/lib/audio-files'
import {
  cloudProviderNames,
  cloudProviders,
  type CloudFile,
  type CloudFolder,
  type CloudFolderEntry,
  type CloudProvider,
} from '~/lib/cloud-storage'
import { maxUploadBytes } from '~/lib/episode-schema'
import { ExpiringStore } from '~/server/expiring-store.server'
import { saveUpload, UploadError } from '~/server/uploads.server'

type Credentials = { clientId: string; clientSecret: string }

function credentials(provider: CloudProvider): Credentials | null {
  const [clientId, clientSecret] =
    provider === 'dropbox' ? [env.DROPBOX_APP_KEY, env.DROPBOX_APP_SECRET] : [env.BOX_CLIENT_ID, env.BOX_CLIENT_SECRET]
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

// The providers set up here, for the Upload folder menu.
export function enabledCloudProviders(): CloudProvider[] {
  return cloudProviders.filter((provider) => credentials(provider) !== null)
}

export const cloudProviderEnabled = (provider: CloudProvider) => credentials(provider) !== null

// The user hasn't signed in to the provider, or their sign-in has run out.
export class CloudNotConnectedError extends Error {}

const redirectUri = (provider: CloudProvider, origin: string) => `${origin}/api/cloud/${provider}/callback`

// Who each sign-in in progress is for, by its OAuth state.
const pendingConnections = new ExpiringStore<{ userId: string; provider: CloudProvider }>(10 * 60_000)

// Access tokens by user and provider. Dropbox's last 4 hours, Box's 1.
const tokens = new ExpiringStore<{ token: string; expiresAt: number }>(4 * 60 * 60_000)
const tokenKey = (userId: string, provider: CloudProvider) => `${userId}:${provider}`

function tokenFor(userId: string, provider: CloudProvider) {
  const entry = tokens.get(tokenKey(userId, provider))
  if (!entry || entry.expiresAt <= Date.now()) throw new CloudNotConnectedError()
  return entry.token
}

// Where to send the user to sign in to the provider.
export function cloudAuthorizeUrl(userId: string, provider: CloudProvider, origin: string) {
  const config = credentials(provider)
  if (!config) throw new Error(`${cloudProviderNames[provider]} is not set up`)
  const state = randomBytes(24).toString('base64url')
  pendingConnections.set(state, { userId, provider })
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri(provider, origin),
    state,
  })
  if (provider === 'dropbox') {
    // A short-lived token, with no refresh token: nothing is kept afterwards.
    params.set('token_access_type', 'online')
    params.set('scope', 'files.metadata.read files.content.read')
    return `https://www.dropbox.com/oauth2/authorize?${params}`
  }
  return `https://account.box.com/api/oauth2/authorize?${params}`
}

const tokenResponseSchema = z.object({ access_token: z.string(), expires_in: z.number().optional() })

// Finishes signing in, keeping the token. False if the sign-in had expired or
// was for someone else.
export async function connectCloud(input: {
  userId: string
  provider: CloudProvider
  state: string | null
  code: string | null
  origin: string
}) {
  const pending = input.state ? pendingConnections.take(input.state) : undefined
  if (!pending || pending.userId !== input.userId || pending.provider !== input.provider || !input.code) return false
  const config = credentials(input.provider)
  if (!config) return false
  const response = await fetch(
    input.provider === 'dropbox' ? 'https://api.dropboxapi.com/oauth2/token' : 'https://api.box.com/oauth2/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri(input.provider, input.origin),
      }),
    },
  )
  if (!response.ok) throw new Error(`${cloudProviderNames[input.provider]} refused the code (${response.status})`)
  const { access_token: token, expires_in: expiresIn = 3600 } = tokenResponseSchema.parse(await response.json())
  // A minute early, so a token doesn't run out in the middle of a download's start.
  tokens.set(tokenKey(input.userId, input.provider), { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 })
  return true
}

export function disconnectCloud(userId: string, provider: CloudProvider) {
  tokens.delete(tokenKey(userId, provider))
}

// Calls a provider's API, dropping the token if it's been refused.
async function call(userId: string, provider: CloudProvider, url: string, init: RequestInit = {}) {
  const token = tokenFor(userId, provider)
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  })
  if (response.status === 401) {
    disconnectCloud(userId, provider)
    throw new CloudNotConnectedError()
  }
  if (!response.ok) {
    throw new Error(`${cloudProviderNames[provider]} answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  return response
}

const toFolder = (folders: CloudFolderEntry[], files: CloudFile[]) => ({
  folders: folders.sort((a, b) => byFileName(a.name, b.name)),
  files: files.filter((file) => isAudioFileName(file.name)).sort((a, b) => byFileName(a.name, b.name)),
})

const dropboxEntrySchema = z.object({
  '.tag': z.string(),
  id: z.string(),
  name: z.string(),
  path_display: z.string().optional(),
  size: z.number().optional(),
})
const dropboxListSchema = z.object({ entries: z.array(dropboxEntrySchema), cursor: z.string(), has_more: z.boolean() })

// Dropbox folders go by path, which gives their parents too.
async function listDropboxFolder(userId: string, path: string): Promise<CloudFolder> {
  const post = (endpoint: string, body: unknown) =>
    call(userId, 'dropbox', `https://api.dropboxapi.com/2/files/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (response) => dropboxListSchema.parse(await response.json()))

  const folders: CloudFolderEntry[] = []
  const files: CloudFile[] = []
  let page = await post('list_folder', { path, limit: 2000 })
  for (;;) {
    for (const entry of page.entries) {
      if (entry['.tag'] === 'folder' && entry.path_display) folders.push({ id: entry.path_display, name: entry.name })
      if (entry['.tag'] === 'file') files.push({ id: entry.id, name: entry.name, size: entry.size ?? 0 })
    }
    if (!page.has_more) break
    page = await post('list_folder/continue', { cursor: page.cursor })
  }

  const names = path.split('/').filter(Boolean)
  const parents = [{ id: '', name: 'Dropbox' }, ...names.map((name, i) => ({ id: `/${names.slice(0, i + 1).join('/')}`, name }))]
  return { id: path, name: parents.pop()!.name, parents, ...toFolder(folders, files) }
}

const boxFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  path_collection: z.object({ entries: z.array(z.object({ id: z.string(), name: z.string() })) }),
})
const boxItemsSchema = z.object({
  total_count: z.number(),
  entries: z.array(z.object({ type: z.string(), id: z.string(), name: z.string(), size: z.number().optional() })),
})

async function listBoxFolder(userId: string, folderId: string): Promise<CloudFolder> {
  const api = 'https://api.box.com/2.0/folders'
  const folder = boxFolderSchema.parse(
    await (await call(userId, 'box', `${api}/${folderId}?fields=id,name,path_collection`)).json(),
  )
  const folders: CloudFolderEntry[] = []
  const files: CloudFile[] = []
  for (let offset = 0; ; ) {
    const page = boxItemsSchema.parse(
      await (await call(userId, 'box', `${api}/${folderId}/items?fields=type,id,name,size&limit=1000&offset=${offset}`)).json(),
    )
    for (const entry of page.entries) {
      if (entry.type === 'folder') folders.push({ id: entry.id, name: entry.name })
      if (entry.type === 'file') files.push({ id: entry.id, name: entry.name, size: entry.size ?? 0 })
    }
    offset += page.entries.length
    if (page.entries.length === 0 || offset >= page.total_count) break
  }
  return { id: folder.id, name: folder.name, parents: folder.path_collection.entries, ...toFolder(folders, files) }
}

// A folder's subfolders and audio files; the top one without a folderId.
export function listCloudFolder(userId: string, provider: CloudProvider, folderId?: string) {
  return provider === 'dropbox' ? listDropboxFolder(userId, folderId ?? '') : listBoxFolder(userId, folderId || '0')
}

// Copies a file from the provider into the user's staged uploads, as if it
// had been uploaded. The name only gives its title (see titleFromFilename).
export async function importCloudFile(userId: string, provider: CloudProvider, fileId: string, name: string) {
  const response =
    provider === 'dropbox'
      ? await call(userId, provider, 'https://content.dropboxapi.com/2/files/download', {
          method: 'POST',
          headers: { 'Dropbox-API-Arg': JSON.stringify({ path: fileId }) },
        })
      : // Box redirects to the file on its download servers.
        await call(userId, provider, `https://api.box.com/2.0/files/${fileId}/content`)
  if (Number(response.headers.get('content-length')) > maxUploadBytes) {
    await response.body?.cancel()
    throw new UploadError('That file is too big to upload', 413)
  }
  if (!response.body) throw new UploadError('That file is empty', 400)
  return saveUpload(userId, response.body, name)
}
