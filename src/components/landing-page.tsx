import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Icons, type Icon } from '~/components/icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

const steps: { icon: Icon; title: string; description: string }[] = [
  {
    icon: Icons.link,
    title: 'Paste a link or upload a file',
    description: 'A YouTube video, a Mixcloud mix, a SoundCloud track, or audio and video from your own machine.',
  },
  {
    icon: Icons.retry,
    title: 'The robots do the rest',
    description: 'Audio is extracted and converted to MP3, and the title, description and artwork are filled in for you.',
  },
  {
    icon: Icons.rss,
    title: 'Listen anywhere',
    description: 'Every podcast gets its own RSS feed, so episodes turn up in whatever podcast app you already use.',
  },
]

const features: { icon: Icon; title: string; description: string }[] = [
  {
    icon: Icons.broadcast,
    title: 'Thousands of sources',
    description: 'If yt-dlp can read it, podnoms can make an episode of it: YouTube, Mixcloud, SoundCloud and many, many more.',
  },
  {
    icon: Icons.upload,
    title: 'Bring your own audio',
    description: 'Upload audio or video files and they are converted to podcast-ready MP3.',
  },
  {
    icon: Icons.logo,
    title: 'Works with every podcast app',
    description: 'Standard RSS feeds for Apple Podcasts, Pocket Casts, Overcast, AntennaPod and the rest.',
  },
  {
    icon: Icons.share,
    title: 'Share and embed',
    description: 'Each episode gets a public page with a waveform player, plus an embeddable player for your site.',
  },
  {
    icon: Icons.duration,
    title: 'Listener stats',
    description: 'See plays, downloads and shares, with the apps and countries your listeners use.',
  },
  {
    icon: Icons.security,
    title: 'Locked down',
    description: 'Sign in with Google, GitHub or Facebook, and protect your account with authenticator apps or security keys.',
  },
]

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
  return (
    <div aria-hidden="true" className="relative">
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
            <div className="flex h-10 items-center gap-[2px]">
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
          <span className="truncate font-mono text-muted-foreground">podnoms.com/feed/my-mixes</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
            <Icons.check className="size-3.5 text-primary" />
            In your feed
          </span>
        </div>
      </div>
    </div>
  )
}

export function LandingPage() {
  return (
    <main className="relative isolate overflow-hidden">
      {/* Soft glow behind the hero. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-[40rem] bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_22%,transparent),transparent)]"
      />

      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-16 pb-20 md:pt-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
          <Badge variant="outline" className="gap-1.5 px-3 py-1 text-sm">
            <img src="/logo.png" alt="" className="size-4 rounded-sm" />
            Robot powered podcasts
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Turn any link into a <span className="text-primary">podcast</span>.
          </h1>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">
            Paste a YouTube, Mixcloud or SoundCloud link, or upload your own audio. podnoms turns it into an episode
            and drops it straight into your podcast app.
          </p>
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
          <h2 className="text-center text-2xl font-semibold tracking-tight md:text-3xl">How it works</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {steps.map(({ icon: StepIcon, title, description }, i) => (
              <li key={title} className="flex flex-col items-center gap-3 text-center">
                <span className="relative grid size-14 place-items-center rounded-2xl border bg-background">
                  <StepIcon className="size-6 text-primary" />
                  <span className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                </span>
                <h3 className="font-medium">{title}</h3>
                <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Everything your feed needs</h2>
          <p className="mt-3 text-muted-foreground">
            For mixes you want on the commute, talks you never get round to watching, or a show of your own.
          </p>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: FeatureIcon, title, description }) => (
            <div key={title} className="flex flex-col gap-2 bg-background p-6">
              <FeatureIcon className="size-5 text-primary" />
              <h3 className="mt-2 font-medium">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-20">
        <div className="relative isolate overflow-hidden rounded-3xl border bg-card px-6 py-14 text-center">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[radial-gradient(50%_80%_at_50%_100%,color-mix(in_oklch,var(--secondary)_18%,transparent),transparent)]"
          />
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Your first episode is one link away</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Create a podcast, paste a link, and subscribe. That's it.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <SignUpButton>Create your podcast</SignUpButton>
            <SignInButton />
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
          <img src="/logo.png" alt="" className="size-5 rounded" />
          podnoms
          <Link to="/privacy" className="ml-4 hover:text-foreground">
            Privacy
          </Link>
          <Link to="/tos" className="hover:text-foreground">
            Terms
          </Link>
          <span className="ml-auto">Robot powered podcasts</span>
        </div>
      </footer>
    </main>
  )
}
