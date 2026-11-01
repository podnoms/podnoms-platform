import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { CopyField } from '~/components/copy-field'
import { Badge } from '~/components/ui/badge'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import {
  fetchSubscriptionAdmin,
  removePatreonDetails,
  removeStripeDetails,
  savePaidFeaturesEnforced,
  savePatreonDetails,
  savePatreonMinimum,
  saveStripeDetails,
} from '~/functions/subscriptions'
import { patreonSettingsSchema, stripeSettingsSchema } from '~/lib/billing-schema'
import { formatDate } from '~/lib/format'
import { freeAudioHours, paidGraceDays } from '~/lib/subscriptions'

type State = Awaited<ReturnType<typeof fetchSubscriptionAdmin>>

// The admin page's Subscriptions tab: whether paid features are on, and how
// many people are paying.
export function AdminSubscriptions() {
  const [state, setState] = useState<State | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  const load = () => fetchSubscriptionAdmin().then(setState)

  useEffect(() => {
    load().catch(() => setError("Couldn't load the subscription settings."))
  }, [])

  async function run(action: () => Promise<unknown>) {
    setPending(true)
    setError(undefined)
    try {
      await action()
      await load()
    } catch {
      setError('Something went wrong saving that. Please try again.')
    } finally {
      setPending(false)
      setConfirming(false)
    }
  }

  function saveMinimum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cents = Number(new FormData(event.currentTarget).get('cents'))
    void run(() => savePatreonMinimum({ data: { cents } }))
  }

  if (!state) return error ? <FieldError>{error}</FieldError> : null

  const configured = state.stripe.configured || state.patreon.configured
  const on = state.startedAt !== null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Paid features</CardTitle>
          <CardDescription>
            Unlimited audio, rather than {freeAudioHours} hours, plus live broadcasts, custom domains, channels and
            playlists, private shows and tracked links.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="paid-features">Require a subscription</FieldLabel>
                <FieldDescription>
                  {on && !configured
                    ? 'On, but these features are free for everyone while neither Stripe nor Patreon is set up.'
                    : on
                      ? `On since ${formatDate(new Date(state.startedAt!))}.`
                      : configured
                        ? 'Off: these features are free for everyone.'
                        : 'Set up Stripe or Patreon below first.'}
                </FieldDescription>
              </FieldContent>
              <Switch
                id="paid-features"
                checked={on}
                disabled={pending || (!on && !configured)}
                onCheckedChange={(value) =>
                  value ? setConfirming(true) : void run(() => savePaidFeaturesEnforced({ data: { enforced: false } }))
                }
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </CardContent>
      </Card>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <StripeCard state={state} onChanged={load} />
        <PatreonCard state={state} onChanged={load} />
      </div>
      {state.patreon.configured && (
        <Card>
          <CardHeader>
            <CardTitle>Patreon pledges</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveMinimum} className="flex max-w-sm items-end gap-2">
              <Field>
                <FieldLabel htmlFor="patreon-minimum">Smallest qualifying pledge, in cents</FieldLabel>
                <Input
                  id="patreon-minimum"
                  name="cents"
                  type="number"
                  min={0}
                  defaultValue={state.patreonMinimumCents}
                />
              </Field>
              <Button type="submit" variant="outline" disabled={pending}>
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Require a subscription for paid features?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone keeps them for {paidGraceDays} days. After that, for anyone who hasn't subscribed, custom domains
              stop serving, channels stop updating, live streams are refused, private feeds stop working and they can't add
              episodes past {freeAudioHours} hours of audio. Nobody is
              emailed about this automatically, so tell your users first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run(() => savePaidFeaturesEnforced({ data: { enforced: true } }))}>
              Turn on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

type Saved = { error: string | null }

// Saving or removing a provider's details, with what went wrong to show.
function useProviderForm(onChanged: () => Promise<unknown>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [confirmRemove, setConfirmRemove] = useState(false)

  async function run(action: () => Promise<Saved>, onSaved?: () => void) {
    setPending(true)
    setError(undefined)
    try {
      const saved = await action()
      if (saved.error) setError(saved.error)
      else {
        await onChanged()
        onSaved?.()
      }
    } catch {
      setError('Something went wrong saving that. Please try again.')
    } finally {
      setPending(false)
      setConfirmRemove(false)
    }
  }

  return { pending, error, setError, confirmRemove, setConfirmRemove, run }
}

const savedSecret = (has: boolean, example: string) => (has ? 'Saved (leave empty to keep it)' : example)

// These aren't logins, so stop browsers and password managers filling them in.
const noAutofill = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const

const secretField = { ...noAutofill, type: 'password', autoComplete: 'new-password' } as const

function DashboardLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
      {children}
    </a>
  )
}

// An address to copy into the provider's dashboard, with what it's for.
function AddressField({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <CopyField label={label} value={value} />
      <FieldDescription>{children}</FieldDescription>
    </Field>
  )
}

function ProviderNotes({ locked, unreadable }: { locked: boolean; unreadable: boolean }) {
  if (locked) {
    return (
      <Alert>
        <AlertDescription>These are set by environment variables, so they can't be changed here.</AlertDescription>
      </Alert>
    )
  }
  if (!unreadable) return null
  return (
    <Alert variant="destructive">
      <AlertDescription>
        A saved secret can't be read, which usually means AUTH_SECRET has changed. Enter the secrets again.
      </AlertDescription>
    </Alert>
  )
}

function RemoveDialog({
  name,
  open,
  onOpenChange,
  onRemove,
}: {
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemove: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove the {name} details?</AlertDialogTitle>
          <AlertDialogDescription>
            People can't subscribe through {name} until they're entered again, and its webhooks will be refused, so
            changes to existing subscriptions are missed. Subscriptions aren't cancelled at {name}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onRemove}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function StripeCard({ state, onChanged }: { state: State; onChanged: () => Promise<unknown> }) {
  const { stripe } = state
  const form = useProviderForm(onChanged)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = event.currentTarget
    const parsed = stripeSettingsSchema.safeParse(Object.fromEntries(new FormData(target)))
    if (!parsed.success) return form.setError(parsed.error.issues[0]?.message)
    void form.run(() => saveStripeDetails({ data: parsed.data }), () => target.reset())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Stripe
          {stripe.configured ? <Badge>{state.activeStripe} active</Badge> : <Badge variant="secondary">Not set up</Badge>}
          {stripe.testMode && <Badge variant="outline">Test mode</Badge>}
        </CardTitle>
        <CardDescription>
          Take care to use the same mode (test or live) for all three values. Saving checks the key and price with
          Stripe.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ProviderNotes locked={stripe.locked} unreadable={stripe.unreadable} />
        <AddressField label="Webhook endpoint" value={state.addresses.stripeWebhook}>
          Add this as an endpoint in <DashboardLink href="https://dashboard.stripe.com/webhooks">Stripe's webhooks</DashboardLink>,
          with the events checkout.session.completed and customer.subscription.created, .updated, .deleted, .paused and
          .resumed.
        </AddressField>
        <form onSubmit={submit}>
          <FieldGroup>
            <fieldset disabled={stripe.locked || form.pending} className="flex flex-col gap-6">
              <Field>
                <FieldLabel htmlFor="stripe-secret-key">Secret key</FieldLabel>
                <Input
                  id="stripe-secret-key"
                  name="secretKey"
                  {...secretField}
                  placeholder={savedSecret(stripe.hasSecretKey, 'sk_test_… or sk_live_…')}
                />
                <FieldDescription>
                  From <DashboardLink href="https://dashboard.stripe.com/apikeys">API keys</DashboardLink>. Not the
                  publishable key.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="stripe-webhook-secret">Webhook signing secret</FieldLabel>
                <Input
                  id="stripe-webhook-secret"
                  name="webhookSecret"
                  {...secretField}
                  placeholder={savedSecret(stripe.hasWebhookSecret, 'whsec_…')}
                />
                <FieldDescription>
                  Shown on the webhook endpoint once it's added, or printed by stripe listen when testing on your own
                  machine.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="stripe-price">Price ID</FieldLabel>
                <Input id="stripe-price" name="priceId" {...noAutofill} placeholder="price_…" defaultValue={stripe.priceId} />
                <FieldDescription>
                  The recurring price people subscribe to, from your{' '}
                  <DashboardLink href="https://dashboard.stripe.com/products">product catalogue</DashboardLink>. Open the
                  price to find its ID, not the product's.
                </FieldDescription>
              </Field>
            </fieldset>
            {form.error && <FieldError>{form.error}</FieldError>}
            {!stripe.locked && (
              <div className="flex gap-2">
                <Button type="submit" disabled={form.pending}>
                  Save
                </Button>
                {stripe.configured && (
                  <Button type="button" variant="ghost" disabled={form.pending} onClick={() => form.setConfirmRemove(true)}>
                    Remove
                  </Button>
                )}
              </div>
            )}
          </FieldGroup>
        </form>
      </CardContent>
      <RemoveDialog
        name="Stripe"
        open={form.confirmRemove}
        onOpenChange={form.setConfirmRemove}
        onRemove={() => void form.run(() => removeStripeDetails())}
      />
    </Card>
  )
}

function PatreonCard({ state, onChanged }: { state: State; onChanged: () => Promise<unknown> }) {
  const { patreon } = state
  const form = useProviderForm(onChanged)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = event.currentTarget
    const parsed = patreonSettingsSchema.safeParse(Object.fromEntries(new FormData(target)))
    if (!parsed.success) return form.setError(parsed.error.issues[0]?.message)
    void form.run(() => savePatreonDetails({ data: parsed.data }), () => target.reset())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Patreon
          {patreon.configured ? <Badge>{state.activePatreon} active</Badge> : <Badge variant="secondary">Not set up</Badge>}
        </CardTitle>
        <CardDescription>Saving doesn't check these with Patreon, so try connecting an account afterwards.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ProviderNotes locked={patreon.locked} unreadable={patreon.unreadable} />
        <AddressField label="Client redirect URI" value={state.addresses.patreonRedirect}>
          Add this to your client in{' '}
          <DashboardLink href="https://www.patreon.com/portal/registration/register-clients">Patreon's client portal</DashboardLink>.
        </AddressField>
        <AddressField label="Webhook address" value={state.addresses.patreonWebhook}>
          Add this in <DashboardLink href="https://www.patreon.com/portal/registration/register-webhooks">Patreon's webhooks</DashboardLink>,
          with the triggers members:pledge:create, members:pledge:update and members:pledge:delete.
        </AddressField>
        <form onSubmit={submit}>
          <FieldGroup>
            <fieldset disabled={patreon.locked || form.pending} className="flex flex-col gap-6">
              <Field>
                <FieldLabel htmlFor="patreon-client-id">Client ID</FieldLabel>
                <Input id="patreon-client-id" name="clientId" {...noAutofill} defaultValue={patreon.clientId} />
                <FieldDescription>From your client in Patreon's client portal.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="patreon-client-secret">Client secret</FieldLabel>
                <Input
                  id="patreon-client-secret"
                  name="clientSecret"
                  {...secretField}
                  placeholder={savedSecret(patreon.hasClientSecret, '')}
                />
                <FieldDescription>From the same client.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="patreon-webhook-secret">Webhook secret</FieldLabel>
                <Input
                  id="patreon-webhook-secret"
                  name="webhookSecret"
                  {...secretField}
                  placeholder={savedSecret(patreon.hasWebhookSecret, '')}
                />
                <FieldDescription>Shown beside the webhook once it's added.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="patreon-campaign">Campaign ID</FieldLabel>
                <Input id="patreon-campaign" name="campaignId" {...noAutofill} defaultValue={patreon.campaignId} />
                <FieldDescription>The number identifying your Patreon page's campaign.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="patreon-url">Page to pledge on (optional)</FieldLabel>
                <Input id="patreon-url" name="url" type="url" {...noAutofill} placeholder="https://www.patreon.com/…" defaultValue={patreon.url} />
                <FieldDescription>Where the subscription page sends people to pledge.</FieldDescription>
              </Field>
            </fieldset>
            {form.error && <FieldError>{form.error}</FieldError>}
            {!patreon.locked && (
              <div className="flex gap-2">
                <Button type="submit" disabled={form.pending}>
                  Save
                </Button>
                {patreon.configured && (
                  <Button type="button" variant="ghost" disabled={form.pending} onClick={() => form.setConfirmRemove(true)}>
                    Remove
                  </Button>
                )}
              </div>
            )}
          </FieldGroup>
        </form>
      </CardContent>
      <RemoveDialog
        name="Patreon"
        open={form.confirmRemove}
        onOpenChange={form.setConfirmRemove}
        onRemove={() => void form.run(() => removePatreonDetails())}
      />
    </Card>
  )
}
