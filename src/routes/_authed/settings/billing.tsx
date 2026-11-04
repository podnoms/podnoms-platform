import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Icons } from '~/components/icons'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { disconnectMyPatreon, fetchMySubscription, openMyBillingPortal, startMyCheckout } from '~/functions/subscriptions'
import { formatDate, formatLength } from '~/lib/format'
import { freeAudioHours, freeFeatures, paidFeatures, paidPlanName, type PaidFeature } from '~/lib/subscriptions'

const patreonMessages = {
  connected: 'Your Patreon account is connected.',
  expired: 'That Patreon connection had expired. Please try again.',
  taken: 'That Patreon account is connected to another user here.',
  failed: "Patreon couldn't be reached. Please try again.",
}

const featureIcons: Record<PaidFeature, keyof typeof Icons> = {
  audio: 'duration',
  live: 'broadcast',
  customDomain: 'globe',
  channels: 'retry',
  privateShows: 'private',
  trackedLinks: 'link',
  showThemes: 'palette',
}

export const Route = createFileRoute('/_authed/settings/billing')({
  validateSearch: z.object({
    checkout: z.literal('done').optional().catch(undefined),
    patreon: z.enum(['connected', 'expired', 'taken', 'failed']).optional().catch(undefined),
  }),
  loader: () => fetchMySubscription(),
  component: BillingSettings,
})

type State = Awaited<ReturnType<typeof fetchMySubscription>>

// Where the user stands, in a sentence.
function planStatus(state: State) {
  const { stripe, patreon } = state
  if (stripe) {
    if (stripe.status === 'past_due') return "Your last payment didn't go through. Please update your payment details."
    if (stripe.cancelAtPeriodEnd && stripe.currentPeriodEnd) {
      return `Your subscription ends on ${formatDate(stripe.currentPeriodEnd)}.`
    }
    if (stripe.currentPeriodEnd) return `Your subscription renews on ${formatDate(stripe.currentPeriodEnd)}.`
    return 'Your subscription is active.'
  }
  if (patreon?.active) return 'Your Patreon pledge gives you all of this. Thank you!'
  if (state.isAdmin) return 'Included with your admin account.'
  if (state.complimentary) return `You have ${paidPlanName} for free, so there's nothing to pay.`
  if (!state.enforced) return 'These features are free for everyone for now, so subscribing is a way to support the site.'
  if (state.graceUntil) {
    return `You have these until ${formatDate(state.graceUntil)}. Subscribe to keep them. Nothing is deleted if they stop.`
  }
  return null
}

// How much of their free audio the user has used.
function AudioUsage({ state }: { state: State }) {
  const used = state.audioUsedSeconds
  const full = used >= state.freeAudioSeconds
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span className="font-medium">Your audio</span>
        <span className="text-muted-foreground">
          {used ? formatLength(used) : 'None'} of {freeAudioHours} free hours
        </span>
      </div>
      <Progress value={Math.min(100, (used / state.freeAudioSeconds) * 100)} aria-label="Free audio used" />
      {full && (
        <p className="text-sm text-muted-foreground">
          You're at the limit. Your episodes keep playing, but you can't add more until you delete some or subscribe.
        </p>
      )}
    </div>
  )
}

function BillingSettings() {
  const state = Route.useLoaderData()
  const { checkout, patreon } = Route.useSearch()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function run(action: () => Promise<void>) {
    setPending(true)
    setError(undefined)
    try {
      await action()
    } catch {
      setError('Something went wrong. Please try again.')
      setPending(false)
    }
  }

  const goTo = (load: () => Promise<string>) => run(async () => window.location.assign(await load()))
  const disconnect = () =>
    run(async () => {
      await disconnectMyPatreon()
      await router.invalidate()
      setPending(false)
    })

  const subscribed = Boolean(state.stripe || state.patreon?.active)
  const canSubscribe = state.stripeAvailable && !subscribed && !state.complimentary
  const status = planStatus(state)

  return (
    <div className="flex flex-col gap-6">
      {checkout && !subscribed && (
        <Alert>
          <AlertDescription>Thanks! Your subscription will show here in a moment. Reload the page if it doesn't.</AlertDescription>
        </Alert>
      )}
      {patreon && (
        <Alert variant={patreon === 'connected' ? 'default' : 'destructive'}>
          <AlertDescription>{patreonMessages[patreon]}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              {paidPlanName}
              {(subscribed || state.complimentary) && <Badge>Active</Badge>}
            </CardTitle>
            <CardDescription className="text-base">
              {freeAudioHours} hours of audio free. Unlimited hours with {paidPlanName}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              {state.enforced && !subscribed && !state.isAdmin && !state.complimentary && <AudioUsage state={state} />}
              {state.price && canSubscribe && <p className="text-3xl font-semibold tracking-tight">{state.price}</p>}
              {status && <p className="text-sm text-muted-foreground">{status}</p>}
              {(canSubscribe || (state.stripe && state.canManageStripe)) && (
                <div className="flex flex-wrap gap-2">
                  {canSubscribe && (
                    <Button size="lg" disabled={pending} onClick={() => void goTo(() => startMyCheckout())}>
                      Subscribe to {paidPlanName}
                    </Button>
                  )}
                  {state.stripe && state.canManageStripe && (
                    <Button variant="outline" disabled={pending} onClick={() => void goTo(() => openMyBillingPortal())}>
                      Manage billing
                    </Button>
                  )}
                </div>
              )}
              {canSubscribe && <p className="text-xs text-muted-foreground">Paid securely through Stripe. Cancel whenever you like.</p>}
            </div>
            <ul className="grid gap-5 border-t pt-6 sm:grid-cols-2 2xl:grid-cols-3">
              {(Object.keys(paidFeatures) as PaidFeature[]).map((feature) => {
                const Icon = Icons[featureIcons[feature]]
                return (
                  <li key={feature} className="flex gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{paidFeatures[feature].title}</span>
                      <span className="text-sm text-muted-foreground">{paidFeatures[feature].description}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Always free</CardTitle>
              <CardDescription>You keep all of this with or without a subscription.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {freeFeatures.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Icons.check className="size-4 shrink-0 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {state.patreonAvailable && (!state.complimentary || state.patreon) && (
            <Card>
              <CardHeader>
                <CardTitle>{state.stripeAvailable ? 'Prefer Patreon?' : `Get ${paidPlanName} through Patreon`}</CardTitle>
                <CardDescription>
                  {state.patreon?.active
                    ? 'Your pledge is connected and active.'
                    : state.patreon
                      ? "Your account is connected, but we can't see a qualifying pledge. If you've just pledged, connect it again."
                      : `A pledge gets you ${paidPlanName} too. Already a patron? Connect your account. Otherwise, pledge first and then connect it.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {state.patreonUrl && !state.patreon?.active && (
                  <Button variant="outline" asChild>
                    <a href={state.patreonUrl} target="_blank" rel="noreferrer">
                      Pledge
                    </a>
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <a href="/api/billing/patreon/connect">{state.patreon ? 'Connect again' : 'Connect Patreon'}</a>
                </Button>
                {state.patreon && (
                  <Button variant="ghost" disabled={pending} onClick={() => void disconnect()}>
                    Disconnect
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
