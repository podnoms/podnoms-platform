// The mobile app's API, which signs in with a token rather than the cookie.
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Secret, TOTP } from 'otpauth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as AudioRoute } from '~/routes/api/episodes/$id/audio'
import { Route as OAuthStartRoute } from '~/routes/api/mobile/auth/oauth/$provider'
import { Route as OAuthExchangeRoute } from '~/routes/api/mobile/auth/oauth/exchange'
import { Route as OAuthFinishRoute } from '~/routes/api/mobile/auth/oauth/finish'
import { Route as ProvidersRoute } from '~/routes/api/mobile/auth/providers'
import { Route as SignInRoute } from '~/routes/api/mobile/auth/sign-in'
import { Route as SignOutRoute } from '~/routes/api/mobile/auth/sign-out'
import { Route as ContinueRoute } from '~/routes/api/mobile/continue-listening'
import { Route as PositionRoute } from '~/routes/api/mobile/episodes/$id/position'
import { Route as EpisodesRoute } from '~/routes/api/mobile/episodes/index'
import { Route as MeRoute } from '~/routes/api/mobile/me'
import { Route as PodcastRoute } from '~/routes/api/mobile/podcasts/$slug'
import { Route as PodcastsRoute } from '~/routes/api/mobile/podcasts/index'
import { oauthProviders, readSession } from '~/server/auth.server'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { handleMobileCors } from '~/server/mobile-api.server'
import { issueMobileToken } from '~/server/mobile-auth.server'
import { episodeAudioPath } from '~/server/storage.server'
import { confirmTotpSetup, startTotpSetup } from '~/server/two-factor.server'
import { createUser as signUp } from '~/server/users.server'
import { resetDb } from '../db'
import { callRoute, createEpisode, createPodcast, createUser, db } from '../helpers'

vi.mock('~/server/episode-processor.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/episode-processor.server')>()),
  enqueueEpisode: vi.fn(),
}))
vi.mock('~/server/link-details.server', () => ({ saveLinkArtwork: vi.fn() }))
// GitHub set up, Facebook not; and whoever the browser has signed in as.
vi.mock('~/server/auth.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/auth.server')>()),
  oauthProviders: { github: true, google: false, facebook: false },
  readSession: vi.fn(),
}))

beforeEach(async () => {
  await resetDb(db)
  vi.mocked(enqueueEpisode).mockClear()
})

function request(path: string, { token, method = 'GET', body }: { token?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return new Request(`http://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function signedIn() {
  const user = await createUser()
  return { user, token: await issueMobileToken(user.id) }
}

describe('signing in and out', () => {
  it('gives a token that works until signing out', async () => {
    await signUp('me@example.com', 'password123')
    const response = await callRoute(
      SignInRoute,
      'POST',
      request('/api/mobile/auth/sign-in', { method: 'POST', body: { email: 'Me@Example.com', password: 'password123' } }),
    )
    expect(response.status).toBe(200)
    const { token } = (await response.json()) as { token: string }

    const me = await callRoute(MeRoute, 'GET', request('/api/mobile/me', { token }))
    expect(await me.json()).toMatchObject({ email: 'me@example.com' })

    await callRoute(SignOutRoute, 'POST', request('/api/mobile/auth/sign-out', { method: 'POST', token }))
    expect((await callRoute(MeRoute, 'GET', request('/api/mobile/me', { token }))).status).toBe(401)
  })

  it('is 401 for the wrong password', async () => {
    await signUp('me@example.com', 'password123')
    const response = await callRoute(
      SignInRoute,
      'POST',
      request('/api/mobile/auth/sign-in', { method: 'POST', body: { email: 'me@example.com', password: 'nope-nope' } }),
    )
    expect(response.status).toBe(401)
  })
})

describe('podcasts', () => {
  it('is 401 without a token', async () => {
    expect((await callRoute(PodcastsRoute, 'GET', request('/api/mobile/podcasts'))).status).toBe(401)
    expect((await callRoute(PodcastsRoute, 'GET', request('/api/mobile/podcasts', { token: 'nope' }))).status).toBe(401)
  })

  it("lists only the user's podcasts, with full URLs", async () => {
    const { user, token } = await signedIn()
    const other = await createUser()
    await createPodcast(user.id, { title: 'Mine', slug: 'mine', imageUrl: '/images/a.jpg' })
    await createPodcast(other.id, { title: 'Theirs', slug: 'theirs' })

    const response = await callRoute(PodcastsRoute, 'GET', request('/api/mobile/podcasts', { token }))
    expect(await response.json()).toEqual([
      expect.objectContaining({ slug: 'mine', title: 'Mine', imageUrl: 'http://x/images/a.jpg' }),
    ])
  })

  it("gives a podcast's episodes in every state, and not someone else's podcast", async () => {
    const { user, token } = await signedIn()
    const other = await createUser()
    const podcast = await createPodcast(user.id, { slug: 'mine', description: '<p>Hello &amp; welcome</p>' })
    await createPodcast(other.id, { slug: 'theirs' })
    await createEpisode(podcast.id, { title: 'Ready', status: 'ready', audioUrl: '/api/episodes/x/audio' })
    await createEpisode(podcast.id, { title: 'Failed', status: 'failed', error: 'Nope' })

    const response = await callRoute(PodcastRoute, 'GET', request('/api/mobile/podcasts/mine', { token }), { slug: 'mine' })
    const body = (await response.json()) as { podcast: { description: string }; episodes: { title: string; status: string }[] }
    expect(body.podcast.description).toBe('Hello & welcome')
    expect(body.episodes.map((e) => [e.title, e.status]).sort()).toEqual([
      ['Failed', 'failed'],
      ['Ready', 'ready'],
    ])

    const theirs = await callRoute(PodcastRoute, 'GET', request('/api/mobile/podcasts/theirs', { token }), { slug: 'theirs' })
    expect(theirs.status).toBe(404)
  })
})

describe('episodes', () => {
  it('adds a link episode to one of the user’s podcasts and queues it', async () => {
    const { user, token } = await signedIn()
    const podcast = await createPodcast(user.id)
    const response = await callRoute(
      EpisodesRoute,
      'POST',
      request('/api/mobile/episodes', { method: 'POST', token, body: { podcastId: podcast.id, sourceUrl: 'https://youtu.be/abc' } }),
    )
    expect(response.status).toBe(201)
    const { id } = (await response.json()) as { id: string }
    expect(enqueueEpisode).toHaveBeenCalledWith(id)
  })

  it("won't add to someone else's podcast", async () => {
    const { token } = await signedIn()
    const podcast = await createPodcast((await createUser()).id)
    const response = await callRoute(
      EpisodesRoute,
      'POST',
      request('/api/mobile/episodes', { method: 'POST', token, body: { podcastId: podcast.id, sourceUrl: 'https://youtu.be/abc' } }),
    )
    expect(response.status).toBe(404)
  })

  it('saves where the user left off, and lists it to carry on with', async () => {
    const { user, token } = await signedIn()
    const podcast = await createPodcast(user.id)
    const episode = await createEpisode(podcast.id, { status: 'ready', audioUrl: '/a', durationSeconds: 600 })
    const saved = await callRoute(
      PositionRoute,
      'POST',
      request(`/api/mobile/episodes/${episode.id}/position`, { method: 'POST', token, body: { seconds: 42.7 } }),
      { id: episode.id },
    )
    expect(saved.status).toBe(204)

    const response = await callRoute(ContinueRoute, 'GET', request('/api/mobile/continue-listening', { token }))
    expect(await response.json()).toEqual([expect.objectContaining({ id: episode.id, positionSeconds: 42, audioUrl: 'http://x/a' })])
  })
})

describe('audio', () => {
  it("plays a private episode's audio for its owner's token, and nobody else", async () => {
    const { user, token } = await signedIn()
    const podcast = await createPodcast(user.id)
    const episode = await createEpisode(podcast.id, { status: 'ready', audioUrl: '/a', private: true })
    const path = episodeAudioPath(episode.id)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'audio')

    const play = (token?: string) =>
      callRoute(AudioRoute, 'GET', request(`/api/episodes/${episode.id}/audio`, { token }), { id: episode.id })
    expect((await play(token)).status).toBe(200)
    expect((await play()).status).toBe(404)
    expect((await play(await issueMobileToken((await createUser()).id))).status).toBe(404)

  })
})

describe('signing in with a provider', () => {
  const verifier = 'v'.repeat(50)
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
  const start = (provider: string, redirectUri: string) =>
    callRoute(
      OAuthStartRoute,
      'GET',
      request(`/api/mobile/auth/oauth/${provider}?${new URLSearchParams({ redirect_uri: redirectUri, code_challenge: codeChallenge })}`),
      { provider },
    )
  const finish = () =>
    callRoute(
      OAuthFinishRoute,
      'GET',
      request(`/api/mobile/auth/oauth/finish?${new URLSearchParams({ redirect_uri: 'podnoms://auth', code_challenge: codeChallenge })}`),
    )
  const exchange = (code: string, codeVerifier = verifier) =>
    callRoute(OAuthExchangeRoute, 'POST', request('/api/mobile/auth/oauth/exchange', { method: 'POST', body: { code, codeVerifier } }))

  it('lists the providers set up here', async () => {
    const response = await callRoute(ProvidersRoute, 'GET', request('/api/mobile/auth/providers'))
    expect(await response.json()).toEqual(oauthProviders)
  })

  it('starts the Auth.js sign-in, coming back through oauth/finish', async () => {
    const response = await start('github', 'podnoms://auth')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('"/api/auth/signin/github"')
    expect(html).toContain('/api/mobile/auth/oauth/finish?redirect_uri=podnoms')
  })

  it("won't start for a provider that isn't set up, or send codes anywhere but the app", async () => {
    expect((await start('facebook', 'podnoms://auth')).status).toBe(404)
    expect((await start('nope', 'podnoms://auth')).status).toBe(404)
    expect((await start('github', 'https://evil.example/steal')).status).toBe(400)
    expect((await start('github', 'http://evil.example/sign-in')).status).toBe(400)
    expect((await start('github', 'http://localhost:19006/elsewhere')).status).toBe(400)
  })

  it("can come back to the app's web build on this machine", async () => {
    expect((await start('github', 'http://localhost:19006/sign-in')).status).toBe(200)
  })

  it('sends the signed-in user back to the app with a code worth one token, for the right verifier', async () => {
    const user = await createUser()
    vi.mocked(readSession).mockResolvedValue({ user: { id: user.id }, expires: '' })

    const location = new URL((await finish()).headers.get('location')!)
    expect(location.protocol).toBe('podnoms:')
    const code = location.searchParams.get('code')!

    expect((await exchange(code, 'w'.repeat(50))).status).toBe(401)
    // A wrong verifier uses the code up, so start again.
    const again = new URL((await finish()).headers.get('location')!).searchParams.get('code')!
    const response = await exchange(again)
    const { token } = (await response.json()) as { token: string }
    expect(await (await callRoute(MeRoute, 'GET', request('/api/mobile/me', { token }))).json()).toMatchObject({ id: user.id })
    expect((await exchange(again)).status).toBe(401)
  })

  it('asks for the second factor of a user who has one', async () => {
    const user = await createUser()
    const { secret } = await startTotpSetup(user.id)
    await confirmTotpSetup(user.id, new TOTP({ secret: Secret.fromBase32(secret) }).generate())
    vi.mocked(readSession).mockResolvedValue({ user: { id: user.id }, expires: '', twoFactorPending: true })

    const code = new URL((await finish()).headers.get('location')!).searchParams.get('code')!
    expect(await (await exchange(code)).json()).toMatchObject({ status: 'two-factor', challenge: expect.any(String) })
  })

  it('sends an error back to the app when nobody signed in', async () => {
    vi.mocked(readSession).mockResolvedValue(null)
    const location = new URL((await finish()).headers.get('location')!)
    expect(location.searchParams.get('error')).toBeTruthy()
    expect(location.searchParams.get('code')).toBeNull()
  })
})

describe('CORS', () => {
  it('answers preflights, and adds the headers to responses, without running the route for a preflight', async () => {
    const next = vi.fn(async () => ({ response: new Response('ok', { headers: { 'content-type': 'text/plain' } }) }))
    const preflight = (await handleMobileCors(new Request('http://x/api/mobile/podcasts', { method: 'OPTIONS' }), next)) as Response
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization')
    expect(next).not.toHaveBeenCalled()

    const result = (await handleMobileCors(new Request('http://x/api/mobile/podcasts'), next)) as { response: Response }
    expect(result.response.headers.get('access-control-allow-origin')).toBe('*')
    expect(result.response.headers.get('content-type')).toBe('text/plain')
    expect(await result.response.text()).toBe('ok')
  })
})
