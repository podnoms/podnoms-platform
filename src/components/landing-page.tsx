import { Link, useLoaderData } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Icons, type Icon } from '~/components/icons'
import { PodcastGrid, type PodcastCardData } from '~/components/podcast-card'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { brandLogoUrl, useBranding, withSiteName } from '~/lib/branding'

// The icons beside each step and feature; their text is the site's own (see
// LandingCopy in src/lib/branding.ts).
const stepIcons: Icon[] = [Icons.link, Icons.retry, Icons.rss]
const featureIcons: Icon[] = [Icons.broadcast, Icons.upload, Icons.logo, Icons.share, Icons.duration, Icons.security]

// The headline, with *words* highlighted.
function Headline({ text }: { text: string }) {
  return text.split(/\*([^*]+)\*/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="text-primary">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

// Bar heights for the decorative waveform, between 0.15 and 1.
const bars = Array.from({ length: 56 }, (_, i) =>
  Math.max(0.15, Math.abs(Math.sin(i * 0.55) * 0.7 + Math.sin(i * 1.7) * 0.3)),
)

function SignUpButton({ children }: { children: ReactNode }) {
  return (
    <Button size="lg" asChild>
      <Link to="." search={(prev) => ({ ...prev, login: 'signup' as const })}>
        {children}
      </Link>
    </Button>
  )
}

function SignInButton() {
  return (
    <Button size="lg" variant="outline" asChild>
      <Link to="." search={(prev) => ({ ...prev, login: true as const })}>
        Sign in
      </Link>
    </Button>
  )
}

// A mock of a link becoming an episode. Decorative only, so hidden from screen readers.
function HeroPreview() {
  const origin = useLoaderData({ from: '__root__', select: (data) => data.siteLinks.origin })
  return (
    <div aria-hidden="true" className="relative min-w-0">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-primary/20 blur-3xl" />
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-2xl sm:p-5">
        <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
          <Icons.link className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-muted-foreground">https://www.youtube.com/watch?v=dQw4w9WgXcQ</span>
          <span className="ml-auto shrink-0 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            Add
          </span>
        </div>

        <div className="flex gap-4 rounded-xl border bg-background/60 p-3">
          <div className="grid size-20 shrink-0 place-items-center rounded-lg bg-linear-to-br from-primary via-accent to-secondary sm:size-24">
            <Icons.logo className="size-9 text-black/70" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">Late night mix, vol. 12</p>
              <p className="text-xs text-muted-foreground">My Mixes · 58:21</p>
            </div>
            <div className="flex h-10 items-center gap-px sm:gap-[2px]">
              {bars.map((height, i) => (
                <span
                  key={i}
                  className={`flex-1 rounded-full ${i < 21 ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  style={{ height: `${height * 100}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2 text-xs">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground">
            <Icons.rss className="size-3.5" />
          </span>
          <span className="truncate font-mono text-muted-foreground">{new URL(origin).host}/feed/my-mixes</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
            <Icons.check className="size-3.5 text-primary" />
            In your feed
          </span>
        </div>
      </div>
    </div>
  )
}

// `podcasts`: some of the site's public shows, so visitors (and search
// engines) can go on to listen.
export function LandingPage({ podcasts }: { podcasts: PodcastCardData[] }) {
  const branding = useBranding()
  const copy = branding.landing
  const text = (value: string) => withSiteName(value, branding)
  return (
    <main className="relative isolate overflow-hidden">
      {/* Soft glow behind the hero. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-[40rem] bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_22%,transparent),transparent)]"
      />

      <section className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-4 pt-16 pb-20 md:pt-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16">
        <div className="flex min-w-0 flex-col items-center gap-6 text-center lg:items-start lg:text-left">
          <Badge variant="outline" className="gap-1.5 px-3 py-1 text-sm">
            <img src={brandLogoUrl(branding)} alt="" className="size-4 rounded-sm" />
            {branding.tagline}
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            <Headline text={text(copy.heroTitle)} />
          </h1>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">{text(copy.heroText)}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <SignUpButton>
              Get started free
              <Icons.back className="rotate-180" />
            </SignUpButton>
            <SignInButton />
          </div>
        </div>
        <HeroPreview />
      </section>

      <section className="border-y bg-card/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 md:py-20">
          <h2 className="text-center text-2xl font-semibold tracking-tight md:text-3xl">{text(copy.stepsTitle)}</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {copy.steps.map(({ title, description }, i) => {
              const StepIcon = stepIcons[i] ?? Icons.logo
              return (
                <li key={i} className="flex flex-col items-center gap-3 text-center">
                  <span className="relative grid size-14 place-items-center rounded-2xl border bg-background">
                    <StepIcon className="size-6 text-primary" />
                    <span className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                  </span>
                  <h3 className="font-medium">{text(title)}</h3>
                  <p className="max-w-xs text-sm text-muted-foreground">{text(description)}</p>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{text(copy.featuresTitle)}</h2>
          <p className="mt-3 text-muted-foreground">{text(copy.featuresText)}</p>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {copy.features.map(({ title, description }, i) => {
            const FeatureIcon = featureIcons[i] ?? Icons.logo
            return (
              <div key={i} className="flex flex-col gap-2 bg-background p-6">
                <FeatureIcon className="size-5 text-primary" />
                <h3 className="mt-2 font-medium">{text(title)}</h3>
                <p className="text-sm text-muted-foreground">{text(description)}</p>
              </div>
            )
          })}
        </div>
      </section>

      {podcasts.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-4 pb-16 md:pb-24">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{text(copy.exploreTitle)}</h2>
              <p className="mt-2 text-muted-foreground">{text(copy.exploreText)}</p>
            </div>
            <Link to="/explore" className="text-sm font-medium text-primary hover:underline">
              Explore all podcasts
            </Link>
          </div>
          <PodcastGrid podcasts={podcasts} />
        </section>
      )}

      <section className="mx-auto w-full max-w-6xl px-4 pb-20">
        <div className="relative isolate overflow-hidden rounded-3xl border bg-card px-6 py-14 text-center">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[radial-gradient(50%_80%_at_50%_100%,color-mix(in_oklch,var(--secondary)_18%,transparent),transparent)]"
          />
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{text(copy.ctaTitle)}</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">{text(copy.ctaText)}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <SignUpButton>Create your podcast</SignUpButton>
            <SignInButton />
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-3 px-4 py-6 text-sm text-muted-foreground">
          <img src={brandLogoUrl(branding)} alt="" className="size-5 rounded" />
          {branding.name}
          <Link to="/privacy" className="ml-4 hover:text-foreground">
            Privacy
          </Link>
          <Link to="/tos" className="hover:text-foreground">
            Terms
          </Link>
          <span className="basis-full sm:ml-auto sm:basis-auto">{branding.tagline}</span>
        </div>
      </footer>
    </main>
  )
}
