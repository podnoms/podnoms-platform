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
import { Route as CommentRoute } from '~/routes/api/mobile/comments/$id/index'
import { Route as CommentLikeRoute } from '~/routes/api/mobile/comments/$id/like'
import { Route as EpisodeCommentsRoute } from '~/routes/api/mobile/episodes/$id/comments'
import { Route as EpisodeRoute } from '~/routes/api/mobile/episodes/$id/index'
import { Route as BroadcastChatRoute } from '~/routes/api/mobile/broadcasts/$id/chat'
import { Route as ChatMessageRoute } from '~/routes/api/mobile/chat/$id'
import { Route as LiveHlsRoute } from '~/routes/api/mobile/live/$slug/hls/$'
import { Route as LiveRoute } from '~/routes/api/mobile/live/$slug/index'
import { Route as FollowsRoute } from '~/routes/api/mobile/follows'
import { Route as HomeRoute } from '~/routes/api/mobile/home'
import { Route as LiveNowRoute } from '~/routes/api/mobile/live/index'
import { Route as MeRoute } from '~/routes/api/mobile/me'
import { Route as DeviceRoute } from '~/routes/api/mobile/notifications/device'
import { Route as NotificationsRoute } from '~/routes/api/mobile/notifications/index'
import { Route as NotificationShowsRoute } from '~/routes/api/mobile/notifications/shows'
import { Route as ShowRoute } from '~/routes/api/mobile/shows/$slug'
import { Route as ShowsRoute } from '~/routes/api/mobile/shows/index'
import { Route as ThemeRoute } from '~/routes/api/mobile/theme'
import { oauthProviders, readSession } from '~/server/auth.server'
import { checkReceipts, sendAppPush } from '~/server/app-push.server'
import { episodeActivity, episodeLikes, liveBroadcasts, mobileTokens, showFollows } from '~/server/db/schema'
import { enqueueEpisode } from '~/server/episode-processor.server'
import { colourKeys, type ModeStyles } from '~/lib/theme-schema'
import { handleMobileCors } from '~/server/mobile-api.server'
import { updateSiteSettings } from '~/server/site-settings.server'
import { issueMobileToken } from '~/server/mobile-auth.server'
import { episodeAudioPath } from '~/server/storage.server'
import { confirmTotpSetup, startTotpSetup } from '~/server/two-factor.server'
import { createUser as signUp } from '~/server/users.server'
import { resetDb } from '../db'
import { callRoute, createEpisode, createShow, createUser, db } from '../helpers'

vi.mock('~/server/episode-processor.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/episode-processor.server')>()),
  enqueueEpisode: vi.fn(),
}))
vi.mock('~/server/link-details.server', () => ({ saveLinkArtwork: vi.fn() }))
vi.mock('~/server/comment-notifications.server', () => ({ notifyCommentRecipients: vi.fn() }))
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

describe('shows', () => {
  it('is 401 without a token', async () => {
    expect((await callRoute(ShowsRoute, 'GET', request('/api/mobile/shows'))).status).toBe(401)
    expect((await callRoute(ShowsRoute, 'GET', request('/api/mobile/shows', { token: 'nope' }))).status).toBe(401)
  })

  it("lists only the user's shows, with full URLs", async () => {
    const { user, token } = await signedIn()
    const other = await createUser()
    await createShow(user.id, { title: 'Mine', slug: 'mine', imageUrl: '/images/a.jpg' })
    await createShow(other.id, { title: 'Theirs', slug: 'theirs' })

    const response = await callRoute(ShowsRoute, 'GET', request('/api/mobile/shows', { token }))
    expect(await response.json()).toEqual([
      expect.objectContaining({ slug: 'mine', title: 'Mine', imageUrl: 'http://x/images/a.jpg' }),
    ])
  })

  it("gives the user's own show's episodes in every state, and not someone else's private show", async () => {
    const { user, token } = await signedIn()
    const other = await createUser()
    const show = await createShow(user.id, { slug: 'mine', description: '<p>Hello &amp; welcome</p>' })
    await createShow(other.id, { slug: 'theirs', private: true })
    await createEpisode(show.id, { title: 'Ready', status: 'ready', audioUrl: '/api/episodes/x/audio' })
    await createEpisode(show.id, { title: 'Failed', status: 'failed', error: 'Nope' })

    const response = await callRoute(ShowRoute, 'GET', request('/api/mobile/shows/mine', { token }), { slug: 'mine' })
    const body = (await response.json()) as { show: { description: string }; episodes: { title: string; status: string }[] }
    expect(body.show.description).toBe('Hello & welcome')
    expect(body.episodes.map((e) => [e.title, e.status]).sort()).toEqual([
      ['Failed', 'failed'],
      ['Ready', 'ready'],
    ])

    const theirs = await callRoute(ShowRoute, 'GET', request('/api/mobile/shows/theirs', { token }), { slug: 'theirs' })
    expect(theirs.status).toBe(404)
  })
})

describe("other people's shows", () => {
  it('gives only what listeners may see, saying whether the user follows it', async () => {
    const { user, token } = await signedIn()
    const other = await createUser()
    const show = await createShow(other.id, { slug: 'theirs', imageUrl: '/images/a.jpg' })
    await createEpisode(show.id, { title: 'Out', status: 'ready', audioUrl: '/api/episodes/x/audio', sourceUrl: 'https://example.com/secret' })
    await createEpisode(show.id, { title: 'Hidden', status: 'ready', audioUrl: '/api/episodes/y/audio', private: true })
    await createEpisode(show.id, { title: 'Broken', status: 'failed', error: 'Nope' })
    await db.insert(showFollows).values({ userId: user.id, showId: show.id })

    const response = await callRoute(ShowRoute, 'GET', request('/api/mobile/shows/theirs', { token }), { slug: 'theirs' })
    expect(await response.json()).toMatchObject({
      show: { slug: 'theirs', isOwner: false, following: true, followerCount: 1, imageUrl: 'http://x/images/a.jpg' },
      episodes: [{ title: 'Out', status: 'ready', sourceUrl: null, error: null, audioUrl: 'http://x/api/episodes/x/audio' }],
    })
  })

  it('follows and unfollows public shows, but not private ones', async () => {
    const { token } = await signedIn()
    const other = await createUser()
    const show = await createShow(other.id, { slug: 'theirs' })
    const hidden = await createShow(other.id, { slug: 'hidden', private: true })
    const follow = (showId: string, following: boolean) =>
      callRoute(FollowsRoute, 'POST', request('/api/mobile/follows', { token, method: 'POST', body: { showId, following } }))

    expect(await (await follow(show.id, true)).json()).toEqual({ following: true, followerCount: 1 })
    expect(await (await follow(show.id, false)).json()).toEqual({ following: false, followerCount: 0 })
    expect((await follow(hidden.id, true)).status).toBe(404)
    expect((await callRoute(FollowsRoute, 'POST', request('/api/mobile/follows', { method: 'POST', body: {} }))).status).toBe(401)
    expect((await callRoute(FollowsRoute, 'POST', request('/api/mobile/follows', { token, method: 'POST', body: {} }))).status).toBe(400)
  })
})

describe('home', () => {
  const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
  const withEpisode = async (ownerId: string, slug: string, values: Record<string, unknown> = {}) => {
    const show = await createShow(ownerId, { slug, ...values })
    const episode = await createEpisode(show.id, { status: 'ready', audioUrl: `/api/episodes/${slug}/audio` })
    return { show, episode }
  }
  const play = (show: { id: string }, episode: { id: string }, visitorHash: string, occurredAt = new Date()) =>
    db.insert(episodeActivity).values({ showId: show.id, episodeId: episode.id, type: 'play', source: 'web', visitorHash, occurredAt })

  it('is 401 without a token', async () => {
    expect((await callRoute(HomeRoute, 'GET', request('/api/mobile/home'))).status).toBe(401)
  })

  it("lists the shows the user follows and their own, each saying if it's live", async () => {
    const { user, token } = await signedIn()
    const other = await createUser()
    const { show: followed } = await withEpisode(other.id, 'followed', { author: 'Someone', imageUrl: '/images/a.jpg' })
    await withEpisode(user.id, 'mine')
    await db.insert(showFollows).values({ userId: user.id, showId: followed.id })
    await db.insert(liveBroadcasts).values({ showId: followed.id, title: 'On air' })

    const home = await (await callRoute(HomeRoute, 'GET', request('/api/mobile/home', { token }))).json()
    expect(home).toMatchObject({
      following: [{ slug: 'followed', author: 'Someone', imageUrl: 'http://x/images/a.jpg', episodeCount: 1, followerCount: 1, live: true }],
      trending: [],
      yours: [{ slug: 'mine', live: false }],
    })
  })

  it('ranks trending by recent plays, likes and follows, leaving out what the user has or can\'t see', async () => {
    const { user, token } = await signedIn()
    const other = await createUser()
    const fan = await createUser()
    await withEpisode(other.id, 'quiet')
    const played = await withEpisode(other.id, 'played')
    const liked = await withEpisode(other.id, 'liked')
    const longFollowed = await withEpisode(other.id, 'old-news')
    const followed = await withEpisode(other.id, 'followed')
    await withEpisode(other.id, 'hidden', { private: true })
    await withEpisode(user.id, 'mine')
    await createShow(other.id, { slug: 'empty' })

    await play(played.show, played.episode, 'a')
    await play(played.show, played.episode, 'b')
    await db.insert(episodeLikes).values({ userId: fan.id, episodeId: liked.episode.id })
    await play(longFollowed.show, longFollowed.episode, 'c', longAgo)
    await db.insert(showFollows).values({ userId: fan.id, showId: longFollowed.show.id, createdAt: longAgo })
    await db.insert(showFollows).values({ userId: user.id, showId: followed.show.id })

    const { trending } = (await (await callRoute(HomeRoute, 'GET', request('/api/mobile/home', { token }))).json()) as { trending: { slug: string }[] }
    const slugs = trending.map((show) => show.slug)
    expect(slugs.slice(0, 2)).toEqual(['liked', 'played'])
    expect(slugs.slice(2).sort()).toEqual(['old-news', 'quiet'])
  })
})

describe('episodes', () => {
  it('adds a link episode to one of the user’s shows and queues it', async () => {
    const { user, token } = await signedIn()
    const show = await createShow(user.id)
    const response = await callRoute(
      EpisodesRoute,
      'POST',
      request('/api/mobile/episodes', { method: 'POST', token, body: { showId: show.id, sourceUrl: 'https://youtu.be/abc' } }),
    )
    expect(response.status).toBe(201)
    const { id } = (await response.json()) as { id: string }
    expect(enqueueEpisode).toHaveBeenCalledWith(id)
  })

  it("won't add to someone else's show", async () => {
    const { token } = await signedIn()
    const show = await createShow((await createUser()).id)
    const response = await callRoute(
      EpisodesRoute,
      'POST',
      request('/api/mobile/episodes', { method: 'POST', token, body: { showId: show.id, sourceUrl: 'https://youtu.be/abc' } }),
    )
    expect(response.status).toBe(404)
  })

  it('saves where the user left off, and lists it to carry on with', async () => {
    const { user, token } = await signedIn()
    const show = await createShow(user.id)
    const episode = await createEpisode(show.id, { status: 'ready', audioUrl: '/a', durationSeconds: 600 })
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
    const show = await createShow(user.id)
    const episode = await createEpisode(show.id, { status: 'ready', audioUrl: '/a', private: true })
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
    const preflight = (await handleMobileCors(new Request('http://x/api/mobile/shows', { method: 'OPTIONS' }), next)) as Response
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization')
    expect(next).not.toHaveBeenCalled()

    const result = (await handleMobileCors(new Request('http://x/api/mobile/shows'), next)) as { response: Response }
    expect(result.response.headers.get('access-control-allow-origin')).toBe('*')
    expect(result.response.headers.get('content-type')).toBe('text/plain')
    expect(await result.response.text()).toBe('ok')
  })
})

describe('theme', () => {
  const getTheme = async () => (await callRoute(ThemeRoute, 'GET', request('/api/mobile/theme'))).json()

  it("is null while the site has app.css's own theme", async () => {
    expect(await getTheme()).toBeNull()
  })

  it("gives the site's theme as HSL triplets, with the radius from either mode", async () => {
    const colours = (primary: string) =>
      Object.fromEntries(colourKeys.map((key) => [key, key === 'primary' ? primary : '#ffffff'])) as ModeStyles
    await updateSiteSettings({
      siteTheme: {
        basedOn: 'test',
        styles: {
          light: { ...colours('oklch(0.6489 0.2370 26.9728)'), radius: '0.5rem' },
          dark: colours('var(--nope)'),
        },
      },
    })
    const theme = (await getTheme()) as {
      basedOn: string
      light: { colours: Record<string, string>; radius: string }
      dark: { colours: Record<string, string>; radius: string }
    }
    expect(theme.basedOn).toBe('test')
    expect(theme.light.colours).toMatchObject({ primary: '0 100% 60%', background: '0 0% 100%' })
    expect(theme.light.radius).toBe('0.5rem')
    // What can't be converted is left to the app's default.
    expect(theme.dark.colours.primary).toBeUndefined()
    expect(theme.dark.radius).toBe('0.5rem')
  })
})

describe('theme freshness', () => {
  it('is never cached, and answers 304 while it hasn\'t changed', async () => {
    const first = await callRoute(ThemeRoute, 'GET', request('/api/mobile/theme'))
    expect(first.headers.get('cache-control')).toBe('no-cache')
    const etag = first.headers.get('etag')!
    const again = new Request('http://x/api/mobile/theme', { headers: { 'if-none-match': etag } })
    expect((await callRoute(ThemeRoute, 'GET', again)).status).toBe(304)

    const colours = Object.fromEntries(colourKeys.map((key) => [key, '#123456'])) as ModeStyles
    await updateSiteSettings({ siteTheme: { basedOn: 'changed', styles: { light: colours, dark: colours } } })
    const changed = await callRoute(ThemeRoute, 'GET', again)
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({ basedOn: 'changed' })
  })
})

describe('episode pages and comments', () => {
  type Segment = { text: string } | { mention: { slug: string } }
  type Comment = { id: string; body: Segment[]; atSeconds: number; likeCount: number; canDelete: boolean; replies: Comment[] }

  const page = (id: string, token: string) =>
    callRoute(EpisodeRoute, 'GET', request(`/api/mobile/episodes/${id}`, { token }), { id })
  const comment = (id: string, token: string, body: unknown) =>
    callRoute(EpisodeCommentsRoute, 'POST', request(`/api/mobile/episodes/${id}/comments`, { method: 'POST', token, body }), { id })

  it("gives the owner their episode in any state, and others only what they may see", async () => {
    const { user, token } = await signedIn()
    const listener = await signedIn()
    const show = await createShow(user.id)
    const pending = await createEpisode(show.id, { status: 'pending', sourceUrl: 'https://youtu.be/x' })
    const ready = await createEpisode(show.id, { status: 'ready', audioUrl: '/a', sourceUrl: 'https://youtu.be/y' })

    const own = (await (await page(pending.id, token)).json()) as { episode: { status: string }; show: { isOwner: boolean }; comments: [] }
    expect(own).toMatchObject({ episode: { status: 'pending' }, show: { isOwner: true }, comments: [] })

    expect((await page(pending.id, listener.token)).status).toBe(404)
    const theirs = (await (await page(ready.id, listener.token)).json()) as { episode: { sourceUrl: string | null }; show: { isOwner: boolean } }
    expect(theirs).toMatchObject({ episode: { sourceUrl: null }, show: { isOwner: false } })
  })

  it('adds comments with mentions, and replies to their thread', async () => {
    const { user, token } = await signedIn()
    await createUser({ slug: 'pat', name: 'Pat' })
    const show = await createShow(user.id)
    const episode = await createEpisode(show.id, { status: 'ready', audioUrl: '/a', durationSeconds: 600 })

    const added = (await (await comment(episode.id, token, { body: 'Great bit, @pat', atSeconds: 90.6 })).json()) as Comment[]
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ atSeconds: 90, canDelete: true, body: [{ text: 'Great bit, ' }, { mention: { slug: 'pat' } }] })

    const replied = (await (await comment(episode.id, token, { body: 'Agreed', atSeconds: 0, parentId: added[0]!.id })).json()) as Comment[]
    expect(replied[0]!.replies).toMatchObject([{ atSeconds: 90, body: [{ text: 'Agreed' }] }])

    expect((await comment(episode.id, token, { body: '   ', atSeconds: 0 })).status).toBe(400)
  })

  it("takes a GIF, alone or with text, but only from the provider's own servers", async () => {
    const { user, token } = await signedIn()
    const show = await createShow(user.id)
    const episode = await createEpisode(show.id, { status: 'ready', audioUrl: '/a' })
    const gif = { provider: 'giphy', id: 'abc', title: 'Dancing', url: 'https://media1.giphy.com/media/abc/200w.webp', width: 200, height: 150 }

    const added = (await (await comment(episode.id, token, { gif, atSeconds: 3 })).json()) as (Comment & { gif: unknown })[]
    expect(added[0]).toMatchObject({ gif, body: [] })

    const elsewhere = { ...gif, url: 'https://evil.example/tracker.gif' }
    expect((await comment(episode.id, token, { body: 'hi', gif: elsewhere, atSeconds: 3 })).status).toBe(400)
  })

  it('likes comments, and lets only the writer or show owner delete them', async () => {
    const owner = await signedIn()
    const writer = await signedIn()
    const other = await signedIn()
    const show = await createShow(owner.user.id)
    const episode = await createEpisode(show.id, { status: 'ready', audioUrl: '/a' })
    const [written] = (await (await comment(episode.id, writer.token, { body: 'Hello', atSeconds: 5 })).json()) as Comment[]

    const like = await callRoute(
      CommentLikeRoute,
      'POST',
      request(`/api/mobile/comments/${written!.id}/like`, { method: 'POST', token: other.token, body: { like: true } }),
      { id: written!.id },
    )
    expect(await like.json()).toEqual({ likeCount: 1, liked: true })

    const remove = (token: string) =>
      callRoute(CommentRoute, 'DELETE', request(`/api/mobile/comments/${written!.id}`, { method: 'DELETE', token }), { id: written!.id })
    expect((await remove(other.token)).status).toBe(404)
    expect((await remove(owner.token)).status).toBe(204)
  })
})

describe('live', () => {
  const gif = { provider: 'giphy', id: 'abc', title: 'A wave', url: 'https://media.giphy.com/media/abc/giphy.gif', width: 200, height: 100 }
  // Slugs are unique per test, as who may watch which show is remembered for a moment.
  const slug = () => `show-${crypto.randomUUID().slice(0, 8)}`
  const goLive = async (showId: string) =>
    (await db.insert(liveBroadcasts).values({ showId, title: 'On air' }).returning())[0]!
  const livePage = async (token: string, showSlug: string) =>
    callRoute(LiveRoute, 'GET', request(`/api/mobile/live/${showSlug}`, { token }), { slug: showSlug })

  it('says which shows are live, in the list and on the show', async () => {
    const { user, token } = await signedIn()
    const on = await createShow(user.id, { slug: 'on' })
    await createShow(user.id, { slug: 'off' })
    await goLive(on.id)

    const list = (await (await callRoute(ShowsRoute, 'GET', request('/api/mobile/shows', { token }))).json()) as { slug: string; live: boolean }[]
    expect(Object.fromEntries(list.map((show) => [show.slug, show.live]))).toEqual({ on: true, off: false })
    for (const [showSlug, live] of [['on', true], ['off', false]] as const) {
      const response = await callRoute(ShowRoute, 'GET', request(`/api/mobile/shows/${showSlug}`, { token }), { slug: showSlug })
      expect(((await response.json()) as { show: { live: boolean } }).show.live).toBe(live)
    }
  })

  it('gives the live page of any show the user may see, counting who is watching', async () => {
    const owner = await signedIn()
    const viewer = await signedIn()
    const showSlug = slug()
    const show = await createShow(owner.user.id, { slug: showSlug, imageUrl: '/images/a.jpg' })
    const broadcast = await goLive(show.id)

    expect((await callRoute(LiveRoute, 'GET', request(`/api/mobile/live/${showSlug}`), { slug: showSlug })).status).toBe(401)
    expect(await (await livePage(owner.token, showSlug)).json()).toMatchObject({ viewers: 1 })
    const page = await (await livePage(viewer.token, showSlug)).json()
    expect(page).toMatchObject({
      show: { slug: showSlug, imageUrl: 'http://x/images/a.jpg' },
      broadcast: { id: broadcast.id, title: 'On air', interrupted: false },
      hlsUrl: `http://x/api/mobile/live/${showSlug}/hls/index.m3u8`,
      chat: [],
      viewers: 2,
    })
    // Asking again doesn't count twice.
    expect(await (await livePage(viewer.token, showSlug)).json()).toMatchObject({ viewers: 2 })
  })

  it('has no broadcast or chat while off air, and hides private shows from others', async () => {
    const owner = await signedIn()
    const viewer = await signedIn()
    const off = slug()
    const secret = slug()
    await createShow(owner.user.id, { slug: off })
    const hidden = await createShow(owner.user.id, { slug: secret, private: true })
    const broadcast = await goLive(hidden.id)

    expect(await (await livePage(viewer.token, off)).json()).toMatchObject({ broadcast: null, chat: [] })
    expect((await livePage(viewer.token, secret)).status).toBe(404)
    expect((await livePage(owner.token, secret)).status).toBe(200)
    const chat = request(`/api/mobile/broadcasts/${broadcast.id}/chat`, { token: viewer.token, method: 'POST', body: { body: 'Hi' } })
    expect((await callRoute(BroadcastChatRoute, 'POST', chat, { id: broadcast.id })).status).toBe(404)
  })

  it('takes chat with text or a GIF, one at a time, and lets the writer or owner delete it', async () => {
    const owner = await signedIn()
    const viewer = await signedIn()
    const other = await signedIn()
    const showSlug = slug()
    const show = await createShow(owner.user.id, { slug: showSlug })
    const broadcast = await goLive(show.id)
    const post = (token: string, body: unknown) =>
      callRoute(BroadcastChatRoute, 'POST', request(`/api/mobile/broadcasts/${broadcast.id}/chat`, { token, method: 'POST', body }), { id: broadcast.id })
    const remove = (token: string, id: string) =>
      callRoute(ChatMessageRoute, 'DELETE', request(`/api/mobile/chat/${id}`, { token, method: 'DELETE' }), { id })

    expect((await post(viewer.token, { body: '  ' })).status).toBe(400)
    const sent = await post(viewer.token, { body: ' Hello 👋 ' })
    expect(sent.status).toBe(201)
    const message = (await sent.json()) as { id: string }
    expect(message).toMatchObject({ body: 'Hello 👋', gif: null, canDelete: true })
    expect((await post(viewer.token, { body: 'Too soon' })).status).toBe(429)
    expect((await post(other.token, { gif })).status).toBe(201)

    const page = (await (await livePage(owner.token, showSlug)).json()) as { chat: { body: string; gif: unknown; canDelete: boolean }[] }
    expect(page.chat.map((m) => [m.body, m.gif, m.canDelete])).toEqual([
      ['Hello 👋', null, true],
      ['', gif, true],
    ])

    expect((await remove(other.token, message.id)).status).toBe(404)
    expect((await remove(viewer.token, message.id)).status).toBe(204)
  })

  it('refuses chat on a broadcast that has ended', async () => {
    const { user, token } = await signedIn()
    const show = await createShow(user.id, { slug: slug() })
    const [ended] = await db.insert(liveBroadcasts).values({ showId: show.id, title: 'Over', endedAt: new Date() }).returning()
    const response = await callRoute(BroadcastChatRoute, 'POST', request('/x', { token, method: 'POST', body: { body: 'Hi' } }), { id: ended!.id })
    expect(response.status).toBe(404)
  })

  it('serves the video by token, to those who may watch', async () => {
    const owner = await signedIn()
    const viewer = await signedIn()
    const showSlug = slug()
    const show = await createShow(owner.user.id, { slug: showSlug, private: true })
    const hls = (token?: string) =>
      callRoute(LiveHlsRoute, 'GET', request(`/api/mobile/live/${showSlug}/hls/index.m3u8`, { token }), { slug: showSlug, _splat: 'index.m3u8' })
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('#EXTM3U', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }))

    expect((await hls()).status).toBe(401)
    expect((await hls(viewer.token)).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
    const response = await hls(owner.token)
    expect(await response.text()).toBe('#EXTM3U')
    expect(String(upstream.mock.calls[0]![0])).toContain(`/live/${show.id}/index.m3u8`)
    upstream.mockRestore()
  })
})

describe('what is live now', () => {
  it('gives the live shows the user may see', async () => {
    const { user, token } = await signedIn()
    const other = await createUser()
    const on = await createShow(other.id, { slug: 'on-air' })
    const hidden = await createShow(other.id, { slug: 'hidden', private: true })
    const mine = await createShow(user.id, { slug: 'mine', private: true })
    const over = await createShow(other.id, { slug: 'over' })
    await createShow(other.id, { slug: 'off' })
    await db.insert(liveBroadcasts).values([
      { showId: on.id, title: 'A' },
      { showId: hidden.id, title: 'B' },
      { showId: mine.id, title: 'C' },
      { showId: over.id, title: 'D', endedAt: new Date() },
    ])

    expect((await callRoute(LiveNowRoute, 'GET', request('/api/mobile/live'))).status).toBe(401)
    const { slugs } = (await (await callRoute(LiveNowRoute, 'GET', request('/api/mobile/live', { token }))).json()) as { slugs: string[] }
    expect(slugs.sort()).toEqual(['mine', 'on-air'])
  })
})

describe('notifications', () => {
  const pushToken = 'ExponentPushToken[abc-123]'
  const device = (token: string | undefined, value: unknown) =>
    callRoute(DeviceRoute, 'POST', request('/api/mobile/notifications/device', { token, method: 'POST', body: { pushToken: value } }))
  const stored = async () => (await db.select({ userId: mobileTokens.userId, pushToken: mobileTokens.pushToken }).from(mobileTokens)).filter((row) => row.pushToken)
  const expoAnswers = (body: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(body))

  it('keeps settings, and mutes followed shows', async () => {
    const { user, token } = await signedIn()
    const other = await createUser()
    const show = await createShow(other.id, { slug: 'followed', title: 'Followed', imageUrl: '/images/a.jpg' })
    const notFollowed = await createShow(other.id, { slug: 'not-followed' })
    await db.insert(showFollows).values({ userId: user.id, showId: show.id })
    const get = async () => (await callRoute(NotificationsRoute, 'GET', request('/api/mobile/notifications', { token }))).json()
    const mute = (showId: string, notify: boolean) =>
      callRoute(NotificationShowsRoute, 'POST', request('/api/mobile/notifications/shows', { token, method: 'POST', body: { showId, notify } }))

    expect(await get()).toEqual({
      live: true,
      newEpisodes: true,
      shows: [{ id: show.id, slug: 'followed', title: 'Followed', imageUrl: 'http://x/images/a.jpg', notify: true }],
    })
    const saved = await callRoute(NotificationsRoute, 'POST', request('/api/mobile/notifications', { token, method: 'POST', body: { live: false, newEpisodes: true } }))
    expect(await saved.json()).toMatchObject({ live: false, newEpisodes: true })
    expect((await callRoute(NotificationsRoute, 'POST', request('/api/mobile/notifications', { token, method: 'POST', body: { live: 'no' } }))).status).toBe(400)

    expect((await mute(show.id, false)).status).toBe(204)
    expect(await get()).toMatchObject({ shows: [{ notify: false }] })
    expect((await mute(notFollowed.id, false)).status).toBe(404)
  })

  it('keeps one device token per device, for whoever signed in last, until sign-out', async () => {
    const first = await signedIn()
    const second = await signedIn()
    expect((await device(undefined, pushToken)).status).toBe(401)
    expect((await device(first.token, 'not a push token')).status).toBe(400)

    expect((await device(first.token, pushToken)).status).toBe(204)
    expect(await stored()).toEqual([{ userId: first.user.id, pushToken }])
    await device(second.token, pushToken)
    expect(await stored()).toEqual([{ userId: second.user.id, pushToken }])
    await device(second.token, null)
    expect(await stored()).toEqual([])

    await device(second.token, pushToken)
    await callRoute(SignOutRoute, 'POST', request('/api/mobile/auth/sign-out', { token: second.token, method: 'POST' }))
    expect(await stored()).toEqual([])
  })

  it('sends through Expo to the devices of those told, forgetting any that have gone', async () => {
    const yes = await signedIn()
    const gone = await signedIn()
    const notAllowed = await signedIn()
    const unrelated = await signedIn()
    await device(yes.token, pushToken)
    await device(gone.token, 'ExponentPushToken[gone]')
    await device(unrelated.token, 'ExponentPushToken[other]')
    const expo = expoAnswers({
      data: [{ status: 'ok', id: 'ticket-1' }, { status: 'error', message: 'Gone', details: { error: 'DeviceNotRegistered' } }],
    })

    await sendAppPush([yes.user.id, gone.user.id, notAllowed.user.id], { title: 'T', body: 'B', path: '/live/x', channel: 'live' })

    expect(expo).toHaveBeenCalledTimes(1)
    const [url, init] = expo.mock.calls[0]!
    expect(url).toBe('https://exp.host/--/api/v2/push/send')
    const sent = JSON.parse(init!.body as string) as { to: string; data: unknown; channelId: string }[]
    expect(sent.map((message) => message.to).sort()).toEqual(['ExponentPushToken[abc-123]', 'ExponentPushToken[gone]'])
    expect(sent[0]).toMatchObject({ title: 'T', body: 'B', data: { path: '/live/x' }, channelId: 'live' })
    expect((await stored()).map((row) => row.pushToken).sort()).toEqual(['ExponentPushToken[abc-123]', 'ExponentPushToken[other]'])
    expo.mockRestore()
  })

  it('sends nothing with no one to tell, and forgets devices receipts say have gone', async () => {
    const { user, token } = await signedIn()
    const expo = expoAnswers({ data: { ticket: { status: 'error', details: { error: 'DeviceNotRegistered' } } } })
    await sendAppPush([user.id], { title: 'T', body: 'B', path: '/live/x', channel: 'live' })
    await sendAppPush([], { title: 'T', body: 'B', path: '/live/x', channel: 'live' })
    expect(expo).not.toHaveBeenCalled()

    await device(token, pushToken)
    await checkReceipts(new Map([['ticket', pushToken]]))
    expect(await stored()).toEqual([])
    expo.mockRestore()
  })
})
