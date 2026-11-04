import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { channels, episodes, notifications, shows, subscriptions, users } from '~/server/db/schema'
import { checkDueChannels, followChannel } from '~/server/channels.server'
import { showForDomain, setCustomDomain } from '~/server/custom-domains.server'
import { createEpisode as createEpisodeFor, getEpisodeAudio } from '~/server/episodes.server'
import { buildShowFeed } from '~/server/feed.server'
import { authorizeLive, createLiveKey } from '~/server/live.server'
import { connectPatreon, disconnectPatreon, handlePatreonWebhook, patreonAuthorizeUrl, validPatreonSignature } from '~/server/patreon.server'
import { servedShowTheme, setShowPrivacy, updateShowTheme } from '~/server/shows.server'
import { createCheckoutUrl, handleStripeWebhook, InvalidWebhookError, setStripeClient } from '~/server/stripe.server'
import {
  AudioLimitError,
  audioSecondsUsed,
  catchAudioLimit,
  hasPaidAccess,
  PaidFeatureError,
  paidFeaturesEnforced,
  recordSubscription,
  requireAudioRoom,
  setComplimentaryAccess,
  setPaidFeaturesEnforced,
} from '~/server/subscriptions.server'
import { createTrackedLink, recordTrackedLinkVisit } from '~/server/tracked-links.server'
import { resetDb } from '../db'
import { createEpisode, createShow, createUser, db } from '../helpers'
import { themePresets } from '~/lib/theme-presets'
import { pickStyles } from '~/lib/theme-schema'

// Saving a show's theme downloads its fonts from Google; fonts.server.test.ts tests that.
vi.mock('~/server/fonts.server', () => ({ prepareFonts: vi.fn(async () => {}) }))

const day = 24 * 60 * 60_000

async function enforceWithGraceOver() {
  await setPaidFeaturesEnforced(true)
  await db.update(users).set({ paidGraceUntil: null })
}

const subscribe = (userId: string, externalId = 'sub_1', active = true) =>
  recordSubscription({
    userId,
    provider: 'stripe',
    externalId,
    status: active ? 'active' : 'canceled',
    active,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  })

beforeEach(async () => {
  await resetDb(db)
  await setPaidFeaturesEnforced(false)
})

afterEach(() => {
  setStripeClient(null)
  vi.unstubAllGlobals()
})

describe('complimentary access', () => {
  const graceOf = async (userId: string) => {
    const [row] = await db.select({ until: users.paidGraceUntil }).from(users).where(eq(users.id, userId))
    return row!.until
  }
  const lapseNotices = (userId: string) => db.select().from(notifications).where(eq(notifications.userId, userId))

  it('gives paid features and unlimited audio without a subscription', async () => {
    await enforceWithGraceOver()
    const user = await createUser()
    expect(await hasPaidAccess(user.id)).toBe(false)

    expect(await setComplimentaryAccess(user.id, true)).toBe(true)

    expect(await hasPaidAccess(user.id)).toBe(true)
    await expect(requireAudioRoom(user.id, 100 * 60 * 60)).resolves.toBeUndefined()
  })

  it('starts the grace period and tells them when it is taken away', async () => {
    await enforceWithGraceOver()
    const user = await createUser()
    await setComplimentaryAccess(user.id, true)

    await setComplimentaryAccess(user.id, false)

    expect((await graceOf(user.id))!.getTime()).toBeGreaterThan(Date.now() + 13 * day)
    expect(await hasPaidAccess(user.id)).toBe(true)
    expect(await lapseNotices(user.id)).toHaveLength(1)
    await db.update(users).set({ paidGraceUntil: new Date(Date.now() - 1000) })
    expect(await hasPaidAccess(user.id)).toBe(false)
  })

  it('does nothing when it is switched off for someone who never had it', async () => {
    await enforceWithGraceOver()
    const user = await createUser()

    expect(await setComplimentaryAccess(user.id, false)).toBe(true)

    expect(await graceOf(user.id)).toBeNull()
    expect(await lapseNotices(user.id)).toHaveLength(0)
  })

  it('gives no grace period to someone still paying', async () => {
    await enforceWithGraceOver()
    const user = await createUser()
    await subscribe(user.id)
    await setComplimentaryAccess(user.id, true)

    await setComplimentaryAccess(user.id, false)

    expect(await graceOf(user.id)).toBeNull()
    expect(await hasPaidAccess(user.id)).toBe(true)
  })

  it("doesn't warn them when a subscription ends, as they keep their features", async () => {
    await enforceWithGraceOver()
    const user = await createUser()
    await subscribe(user.id)
    await setComplimentaryAccess(user.id, true)

    await subscribe(user.id, 'sub_1', false)

    expect(await hasPaidAccess(user.id)).toBe(true)
    expect(await lapseNotices(user.id)).toHaveLength(0)
  })

  it('reports a user that does not exist', async () => {
    expect(await setComplimentaryAccess('nobody', true)).toBe(false)
  })
})

describe('access', () => {
  it('leaves everything free until paid features are turned on', async () => {
    const user = await createUser()
    expect(await paidFeaturesEnforced()).toBe(false)
    expect(await hasPaidAccess(user.id)).toBe(true)
  })

  it('gives everyone there at the time 14 days, but not later sign-ups', async () => {
    const existing = await createUser()
    const now = new Date()
    await setPaidFeaturesEnforced(true, now)
    const later = await createUser()
    const [row] = await db.select().from(users).where(eq(users.id, existing.id))
    expect(row!.paidGraceUntil!.getTime()).toBe(now.getTime() + 14 * day)
    expect(await hasPaidAccess(existing.id)).toBe(true)
    expect(await hasPaidAccess(later.id)).toBe(false)
  })

  it('ends access when the grace period does', async () => {
    const user = await createUser()
    await setPaidFeaturesEnforced(true)
    await db.update(users).set({ paidGraceUntil: new Date(Date.now() - 1000) })
    expect(await hasPaidAccess(user.id)).toBe(false)
  })

  it('always gives admins access', async () => {
    await enforceWithGraceOver()
    const admin = await createUser({ isAdmin: true })
    expect(await hasPaidAccess(admin.id)).toBe(true)
  })

  it('starts a grace period only when the last active subscription ends', async () => {
    await enforceWithGraceOver()
    const user = await createUser()
    await subscribe(user.id, 'sub_a')
    await subscribe(user.id, 'sub_b')
    await subscribe(user.id, 'sub_a', false)
    let [row] = await db.select().from(users).where(eq(users.id, user.id))
    expect(row!.paidGraceUntil).toBeNull()

    await subscribe(user.id, 'sub_b', false)
    ;[row] = await db.select().from(users).where(eq(users.id, user.id))
    expect(row!.paidGraceUntil!.getTime()).toBeGreaterThan(Date.now() + 13 * day)
    expect(await hasPaidAccess(user.id)).toBe(true)
    const told = await db.select().from(notifications).where(eq(notifications.userId, user.id))
    expect(told.map((item) => item.kind)).toEqual(['subscriptionLapsed'])
  })

  it("doesn't start another grace period when an ended subscription is repeated", async () => {
    await enforceWithGraceOver()
    const user = await createUser()
    await subscribe(user.id)
    await subscribe(user.id, 'sub_1', false)
    await db.update(users).set({ paidGraceUntil: new Date(Date.now() - 1000) })
    await subscribe(user.id, 'sub_1', false)
    expect(await hasPaidAccess(user.id)).toBe(false)
  })
})

describe('gated features, once a user has no access', () => {
  it('refuses new custom domains and stops serving verified ones, keeping them', async () => {
    const user = await createUser()
    const show = await createShow(user.id, { customDomain: 'pod.example.com', customDomainVerifiedAt: new Date(), customDomainToken: 't' })
    expect(await showForDomain('pod.example.com')).toBe(show.slug)
    await enforceWithGraceOver()
    await expect(setCustomDomain(user.id, show.id, 'other.example.com')).rejects.toBeInstanceOf(PaidFeatureError)
    // A domain not looked up yet, as lookups are cached for a minute.
    await createShow(user.id, { customDomain: 'two.example.com', customDomainVerifiedAt: new Date(), customDomainToken: 't' })
    expect(await showForDomain('two.example.com')).toBeNull()
    await expect(setCustomDomain(user.id, show.id, null)).resolves.toBe(true)
  })

  it('refuses making a show private, but lets it go public', async () => {
    const user = await createUser()
    const show = await createShow(user.id, { private: true, feedKey: 'key' })
    await enforceWithGraceOver()
    await expect(setShowPrivacy(user.id, show.id, true)).rejects.toBeInstanceOf(PaidFeatureError)
    await expect(setShowPrivacy(user.id, show.id, false)).resolves.toBe(true)
  })

  it('stops the feed key working, and never makes a private show public', async () => {
    const user = await createUser()
    const show = await createShow(user.id, { private: true, feedKey: 'key' })
    const episode = await createEpisode(show.id, { status: 'ready', publishedAt: new Date() })
    const access = { key: 'key', viewerId: async () => null }
    expect(await buildShowFeed(show.slug, 'https://site.test', { key: 'key' })).toContain('<rss')
    expect(await getEpisodeAudio(episode.id, access)).not.toBeNull()

    await enforceWithGraceOver()
    expect(await buildShowFeed(show.slug, 'https://site.test', { key: 'key' })).toBeNull()
    expect(await buildShowFeed(show.slug, 'https://site.test')).toBeNull()
    expect(await getEpisodeAudio(episode.id, access)).toBeNull()
    const [row] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(row!.private).toBe(true)
    // The owner can still hear their own.
    expect(await getEpisodeAudio(episode.id, { key: null, viewerId: async () => user.id })).not.toBeNull()

    await subscribe(user.id)
    expect(await buildShowFeed(show.slug, 'https://site.test', { key: 'key' })).toContain('<rss')
  })

  it("refuses a live stream with a good key, and making a key", async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    const made = await createLiveKey(user.id, show.id)
    const key = new URLSearchParams(made!.streamKey.split('?')[1]).get('key')
    const request = { action: 'publish', path: `live/${show.id}`, query: `key=${key}` }
    expect(await authorizeLive(request)).toBe(true)
    await enforceWithGraceOver()
    expect(await authorizeLive(request)).toBe(false)
    await expect(createLiveKey(user.id, show.id)).rejects.toBeInstanceOf(PaidFeatureError)
  })

  it('refuses following a channel, and skips due checks while keeping them due', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    const dueAt = new Date(Date.now() - 1000)
    await db.insert(channels).values({ showId: show.id, platform: 'youtube', kind: 'channel', url: 'https://www.youtube.com/@x', nextCheckAt: dueAt })
    await enforceWithGraceOver()
    await expect(followChannel(user.id, { platform: 'youtube', url: 'https://www.youtube.com/@y' })).rejects.toBeInstanceOf(PaidFeatureError)
    expect(await checkDueChannels()).toMatchObject({ checked: 0 })
    const [row] = await db.select().from(channels).where(eq(channels.showId, show.id))
    expect(row!.nextCheckAt).toEqual(dueAt)
  })

  it('refuses new tracked links, and stops counting visits to old ones', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    const episode = await createEpisode(show.id)
    await createTrackedLink(user.id, episode.id, 'Alex')
    const [link] = await db.query.trackedLinks.findMany()
    const visit = { type: 'open', episodeId: episode.id } as const
    const who = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', viewerId: null }
    expect(await recordTrackedLinkVisit(link!.token, visit, who)).toBe(true)
    await enforceWithGraceOver()
    await expect(createTrackedLink(user.id, episode.id, 'Sam')).rejects.toBeInstanceOf(PaidFeatureError)
    expect(await recordTrackedLinkVisit(link!.token, visit, who)).toBe(false)
  })

  it("refuses a show theme, stops its pages using one saved before (keeping it), and lets it be taken away", async () => {
    const { light, dark } = themePresets['modern-minimal']!.styles
    const theme = { basedOn: 'modern-minimal', styles: { light: pickStyles(light), dark: pickStyles(dark) } }
    const user = await createUser()
    const show = await createShow(user.id)
    await updateShowTheme(user.id, { id: show.id, theme })
    expect(await servedShowTheme(user.id, theme)).toMatchObject({ css: expect.stringContaining('html:root:root{') })
    await enforceWithGraceOver()
    await expect(updateShowTheme(user.id, { id: show.id, theme })).rejects.toBeInstanceOf(PaidFeatureError)
    expect(await servedShowTheme(user.id, theme)).toBeNull()
    const [row] = await db.select().from(shows).where(eq(shows.id, show.id))
    expect(row!.theme).toEqual(theme)
    await subscribe(user.id)
    expect(await servedShowTheme(user.id, theme)).not.toBeNull()
  })

  it('lets a show theme be taken away without access', async () => {
    const user = await createUser()
    const show = await createShow(user.id)
    await enforceWithGraceOver()
    await expect(updateShowTheme(user.id, { id: show.id, theme: null })).resolves.toBe(true)
  })
})

describe('Stripe webhooks', () => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET!
  const real = new Stripe('sk_test_fake')

  function fakeStripe(subscription: object) {
    setStripeClient({
      webhooks: real.webhooks,
      subscriptions: { retrieve: vi.fn(async () => subscription) },
    } as unknown as Stripe)
  }

  const signed = (body: string) => real.webhooks.generateTestHeaderString({ payload: body, secret })

  const event = (type: string, object: object) =>
    JSON.stringify({ id: 'evt_1', object: 'event', type, data: { object } })

  const stripeSubscription = (status: string) => ({
    id: 'sub_1',
    customer: 'cus_1',
    status,
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: 2_000_000_000 }] },
  })

  it('refuses a bad signature', async () => {
    fakeStripe(stripeSubscription('active'))
    await expect(handleStripeWebhook('{}', 'nope')).rejects.toBeInstanceOf(InvalidWebhookError)
  })

  it('follows a subscription by fetching it, whatever the event says', async () => {
    await enforceWithGraceOver()
    const user = await createUser({ stripeCustomerId: 'cus_1' })
    fakeStripe(stripeSubscription('active'))
    // An out-of-date object in the event: the fetched one is what counts.
    const body = event('customer.subscription.updated', { id: 'sub_1', status: 'canceled' })
    await handleStripeWebhook(body, signed(body))
    expect(await hasPaidAccess(user.id)).toBe(true)
    const [row] = await db.select().from(subscriptions)
    expect(row).toMatchObject({ status: 'active', active: true, currentPeriodEnd: new Date(2_000_000_000_000) })
  })

  it('keeps access while past due, and starts the grace period once cancelled', async () => {
    await enforceWithGraceOver()
    const user = await createUser({ stripeCustomerId: 'cus_1' })
    const send = async (status: string) => {
      fakeStripe(stripeSubscription(status))
      const body = event('customer.subscription.updated', { id: 'sub_1' })
      await handleStripeWebhook(body, signed(body))
    }
    await send('active')
    await send('past_due')
    expect((await db.select().from(subscriptions))[0]!.active).toBe(true)
    await send('canceled')
    expect((await db.select().from(subscriptions))[0]!.active).toBe(false)
    const [row] = await db.select().from(users).where(eq(users.id, user.id))
    expect(row!.paidGraceUntil).not.toBeNull()
  })

  it('makes a new customer when the saved one is from other keys', async () => {
    const user = await createUser({ stripeCustomerId: 'cus_from_test_mode' })
    const create = vi.fn(async ({ customer }: { customer: string }) => {
      if (customer === 'cus_from_test_mode') throw Object.assign(new Error('No such customer'), { code: 'resource_missing', param: 'customer' })
      return { url: 'https://checkout.test/session' }
    })
    setStripeClient({
      customers: { create: vi.fn(async () => ({ id: 'cus_new' })) },
      checkout: { sessions: { create } },
    } as unknown as Stripe)
    expect(await createCheckoutUrl(user.id, 'https://site.test')).toBe('https://checkout.test/session')
    const [row] = await db.select().from(users).where(eq(users.id, user.id))
    expect(row!.stripeCustomerId).toBe('cus_new')
  })

  it('ignores subscriptions of customers it never made', async () => {
    fakeStripe({ ...stripeSubscription('active'), customer: 'cus_someone_else' })
    const body = event('customer.subscription.created', { id: 'sub_1' })
    await handleStripeWebhook(body, signed(body))
    expect(await db.select().from(subscriptions)).toEqual([])
  })
})

describe('Patreon', () => {
  const member = (attributes: object, campaign = 'campaign-1', user = 'patron-1') => ({
    id: 'member-1',
    type: 'member',
    attributes,
    relationships: { campaign: { data: { id: campaign } }, user: { data: { id: user } } },
  })
  const pledged = { patron_status: 'active_patron', currently_entitled_amount_cents: 500, next_charge_date: '2030-01-01T00:00:00Z' }

  function fakePatreon(included: object[], id = 'patron-1') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) =>
        String(url).includes('/token')
          ? Response.json({ access_token: 'token' })
          : Response.json({ data: { id }, included: [{ id: 'campaign-1', type: 'campaign' }, ...included] }),
      ),
    )
  }

  async function connect(userId: string) {
    const authorize = new URL(await patreonAuthorizeUrl(userId, 'https://site.test'))
    return connectPatreon({ userId, state: authorize.searchParams.get('state'), code: 'code', origin: 'https://site.test' })
  }

  it('checks the signature of the raw body', async () => {
    const body = '{"a":1}'
    const good = createHmac('md5', process.env.PATREON_WEBHOOK_SECRET!).update(body).digest('hex')
    expect(await validPatreonSignature(body, good)).toBe(true)
    expect(await validPatreonSignature(`${body} `, good)).toBe(false)
    expect(await validPatreonSignature(body, null)).toBe(false)
  })

  it("won't connect with someone else's state", async () => {
    const [mine, theirs] = [await createUser(), await createUser()]
    const authorize = new URL(await patreonAuthorizeUrl(theirs.id, 'https://site.test'))
    const state = authorize.searchParams.get('state')
    expect(await connectPatreon({ userId: mine.id, state, code: 'code', origin: 'https://site.test' })).toEqual({ error: 'expired' })
  })

  it('gives access for a pledge to our campaign', async () => {
    await enforceWithGraceOver()
    const user = await createUser()
    fakePatreon([member(pledged)])
    expect(await connect(user.id)).toEqual({ error: null })
    expect(await hasPaidAccess(user.id)).toBe(true)
  })

  it.each([
    ['another campaign', member(pledged, 'campaign-2')],
    ['a declined pledge', member({ ...pledged, patron_status: 'declined_patron' })],
    ['a free membership', member({ ...pledged, currently_entitled_amount_cents: 0 })],
  ])('gives no access for %s', async (_, item) => {
    await enforceWithGraceOver()
    const user = await createUser()
    fakePatreon([item])
    await connect(user.id)
    expect(await hasPaidAccess(user.id)).toBe(false)
  })

  it('lets one pledge pay for only one account', async () => {
    const [first, second] = [await createUser(), await createUser()]
    fakePatreon([member(pledged)])
    await connect(first.id)
    expect(await connect(second.id)).toEqual({ error: 'taken' })
  })

  it('follows pledges through webhooks, and ignores those not connected', async () => {
    await enforceWithGraceOver()
    const user = await createUser()
    fakePatreon([member(pledged)])
    await connect(user.id)
    await handlePatreonWebhook(JSON.stringify({ data: member(pledged, 'campaign-1', 'stranger') }), 'members:pledge:update')
    expect(await db.select().from(subscriptions)).toHaveLength(1)

    await handlePatreonWebhook(JSON.stringify({ data: member(pledged) }), 'members:pledge:delete')
    const [row] = await db.select().from(subscriptions)
    expect(row!.active).toBe(false)
    const [saved] = await db.select().from(users).where(eq(users.id, user.id))
    expect(saved!.paidGraceUntil).not.toBeNull()
  })

  it('starts a grace period on disconnecting an active pledge', async () => {
    await enforceWithGraceOver()
    const user = await createUser()
    fakePatreon([member(pledged)])
    await connect(user.id)
    await disconnectPatreon(user.id)
    expect(await db.select().from(subscriptions)).toEqual([])
    expect(await hasPaidAccess(user.id)).toBe(true)
  })

  it('starts a grace period on swapping an active pledge for an account with none', async () => {
    await enforceWithGraceOver()
    const user = await createUser()
    fakePatreon([member(pledged)])
    await connect(user.id)
    fakePatreon([], 'patron-2')
    await connect(user.id)
    const rows = await db.select().from(subscriptions)
    expect(rows.map((row) => row.externalId)).toEqual(['patron-2'])
    expect(await hasPaidAccess(user.id)).toBe(true)
  })
})

describe('free audio limit', () => {
  const hours = (count: number) => count * 60 * 60
  const link = (showId: string) => ({ showId, sourceUrl: 'https://youtube.test/watch?v=a' }) as never

  async function freeUser(usedHours: number) {
    const user = await createUser()
    const show = await createShow(user.id)
    if (usedHours) await createEpisode(show.id, { status: 'ready', durationSeconds: hours(usedHours) })
    return { user, show }
  }

  it("doesn't limit anyone until paid features are on", async () => {
    const { user } = await freeUser(50)
    await expect(requireAudioRoom(user.id, hours(5))).resolves.toBeUndefined()
  })

  it('allows up to 10 hours, across all of a user\'s shows', async () => {
    const { user } = await freeUser(4)
    const second = await createShow(user.id)
    await createEpisode(second.id, { status: 'ready', durationSeconds: hours(4) })
    await enforceWithGraceOver()
    await expect(requireAudioRoom(user.id, hours(2))).resolves.toBeUndefined()
    await expect(requireAudioRoom(user.id, hours(2) + 1)).rejects.toBeInstanceOf(AudioLimitError)
  })

  it('refuses a link of unknown length only once at the limit', async () => {
    const { user } = await freeUser(9)
    await enforceWithGraceOver()
    await expect(requireAudioRoom(user.id, 0)).resolves.toBeUndefined()
    const show = await createShow(user.id)
    await createEpisode(show.id, { status: 'ready', durationSeconds: hours(1) })
    await expect(requireAudioRoom(user.id, 0)).rejects.toBeInstanceOf(AudioLimitError)
  })

  it("doesn't count failed episodes, or other people's", async () => {
    const { user, show } = await freeUser(0)
    await createEpisode(show.id, { status: 'failed', durationSeconds: hours(20) })
    const other = await freeUser(20)
    expect(await audioSecondsUsed(user.id)).toBe(0)
    expect(await audioSecondsUsed(other.user.id)).toBe(hours(20))
  })

  it('leaves subscribers, admins and those in their grace period unlimited', async () => {
    const subscriber = await freeUser(20)
    const admin = await createUser({ isAdmin: true })
    await enforceWithGraceOver()
    await subscribe(subscriber.user.id)
    await expect(requireAudioRoom(subscriber.user.id, hours(5))).resolves.toBeUndefined()
    await expect(requireAudioRoom(admin.id, hours(50))).resolves.toBeUndefined()

    const lapsing = await freeUser(20)
    await subscribe(lapsing.user.id, 'sub_lapsing')
    await subscribe(lapsing.user.id, 'sub_lapsing', false)
    await expect(requireAudioRoom(lapsing.user.id, hours(5))).resolves.toBeUndefined()
  })

  it('refuses new episodes over the limit, but leaves existing audio playing', async () => {
    const { user, show } = await freeUser(12)
    const [existing] = await db.select().from(episodes).where(eq(episodes.showId, show.id))
    await enforceWithGraceOver()
    await expect(createEpisodeFor(user.id, link(show.id))).rejects.toBeInstanceOf(AudioLimitError)
    expect(await getEpisodeAudio(existing!.id, { key: null, viewerId: async () => null })).not.toBeNull()
    expect(await db.select().from(episodes).where(eq(episodes.showId, show.id))).toHaveLength(1)
  })

  it('gives the refusal back for a form to show', async () => {
    const { user, show } = await freeUser(12)
    await enforceWithGraceOver()
    const result = await catchAudioLimit(() => createEpisodeFor(user.id, link(show.id)))
    expect(result).toEqual({ error: expect.stringContaining('10 free hours') })
    await expect(catchAudioLimit(async () => { throw new Error('other') })).rejects.toThrow('other')
  })

  it('makes room when an episode is deleted', async () => {
    const { user, show } = await freeUser(10)
    await enforceWithGraceOver()
    await expect(requireAudioRoom(user.id, 0)).rejects.toBeInstanceOf(AudioLimitError)
    await db.delete(episodes).where(eq(episodes.showId, show.id))
    await expect(requireAudioRoom(user.id, 0)).resolves.toBeUndefined()
  })

  it('lets a replacement take the place of the audio it replaces', async () => {
    const { user, show } = await freeUser(10)
    const [existing] = await db.select().from(episodes).where(eq(episodes.showId, show.id))
    await enforceWithGraceOver()
    await expect(requireAudioRoom(user.id, hours(10), { except: existing!.id })).resolves.toBeUndefined()
    await expect(requireAudioRoom(user.id, hours(10) + 1, { except: existing!.id })).rejects.toBeInstanceOf(AudioLimitError)
  })
})
