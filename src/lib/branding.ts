// The site's identity (name, logo, copy, theme, analytics), which admins set
// on the Branding and Theme tabs at /admin so one image can run several differently branded sites. The
// root route loads it (see fetchBranding); this module is shared by client and
// server. Anything left unset is the default below.
import { useLoaderData } from '@tanstack/react-router'
import type { SiteTheme } from '~/lib/theme-schema'

export type CopyItem = { title: string; description: string }

// The signed-out home page's text. `{name}` is replaced with the site's name,
// and *words* in the hero title are highlighted.
export type LandingCopy = {
  heroTitle: string
  heroText: string
  stepsTitle: string
  steps: CopyItem[]
  featuresTitle: string
  featuresText: string
  features: CopyItem[]
  exploreTitle: string
  exploreText: string
  ctaTitle: string
  ctaText: string
}

export type Branding = {
  name: string
  // Shown under the name in emails, on the landing page and its footer.
  tagline: string
  // What the site does, in a sentence: the default description for search
  // results and link previews.
  description: string
  // Where people write about their data or the terms.
  contactEmail: string
  // Changes with each uploaded logo, so its URLs do; null for the default logo.
  logoVersion: string | null
  landing: LandingCopy
  // Replacements for the built-in privacy policy and terms, as sanitised HTML.
  privacyHtml: string | null
  termsHtml: string | null
  // A script tag for the site's analytics, added to every page.
  analytics: { src: string; attributes: Record<string, string> } | null
  // The theme admins made on the Theme tab (see theme-schema.ts), its CSS and
  // the Google Fonts it uses, which every page's <head> carries; null for
  // app.css's own theme.
  theme: (SiteTheme & { css: string; fonts: string[] }) | null
}

export const landingStepCount = 3
export const landingFeatureCount = 6

export const defaultLandingCopy: LandingCopy = {
  heroTitle: 'Turn any link into a *podcast*.',
  heroText:
    'Paste a YouTube, Mixcloud or SoundCloud link, or upload your own audio. {name} turns it into an episode and drops it straight into your podcast app.',
  stepsTitle: 'How it works',
  steps: [
    {
      title: 'Paste a link or upload a file',
      description: 'A YouTube video, a Mixcloud mix, a SoundCloud track, or audio and video from your own machine.',
    },
    {
      title: 'The robots do the rest',
      description: 'Audio is extracted and converted to MP3, and the title, description and artwork are filled in for you.',
    },
    {
      title: 'Listen anywhere',
      description: 'Every podcast gets its own RSS feed, so episodes turn up in whatever podcast app you already use.',
    },
  ],
  featuresTitle: 'Everything your feed needs',
  featuresText: 'For mixes you want on the commute, talks you never get round to watching, or a show of your own.',
  features: [
    {
      title: 'Thousands of sources',
      description: 'If yt-dlp can read it, {name} can make an episode of it: YouTube, Mixcloud, SoundCloud and many, many more.',
    },
    { title: 'Bring your own audio', description: 'Upload audio or video files and they are converted to podcast-ready MP3.' },
    {
      title: 'Works with every podcast app',
      description: 'Standard RSS feeds for Apple Podcasts, Pocket Casts, Overcast, AntennaPod and the rest.',
    },
    {
      title: 'Share and embed',
      description: 'Each episode gets a public page with a waveform player, plus an embeddable player for your site.',
    },
    { title: 'Listener stats', description: 'See plays, downloads and shares, with the apps and countries your listeners use.' },
    {
      title: 'Locked down',
      description: 'Sign in with Google, GitHub or Facebook, and protect your account with authenticator apps or security keys.',
    },
  ],
  exploreTitle: 'Listen on {name}',
  exploreText: 'Shows people have made here, for anyone to listen to.',
  ctaTitle: 'Your first episode is one link away',
  ctaText: "Create a podcast, paste a link, and subscribe. That's it.",
}

export const defaultBranding: Branding = {
  name: 'podnoms',
  tagline: 'Robot powered podcasts',
  description:
    'Turn YouTube, Mixcloud and SoundCloud links, or your own audio and video, into podcasts with their own RSS feeds.',
  contactEmail: 'hello@podnoms.com',
  logoVersion: null,
  landing: defaultLandingCopy,
  privacyHtml: null,
  termsHtml: null,
  analytics: null,
  theme: null,
}

// The sizes the logo is served at (see brand.$file.ts): favicons, the Apple
// touch icon, the web manifest's icons, and the logo itself.
export const brandIconSizes = [16, 32, 180, 192, 512] as const
export type BrandIconSize = (typeof brandIconSizes)[number]

const versioned = (path: string, branding: Pick<Branding, 'logoVersion'>) =>
  branding.logoVersion ? `${path}?v=${branding.logoVersion}` : path

// The square logo, at 512px.
export function brandLogoUrl(branding: Pick<Branding, 'logoVersion'>) {
  return versioned('/brand/logo.png', branding)
}

export function brandIconUrl(branding: Pick<Branding, 'logoVersion'>, size: BrandIconSize) {
  return versioned(`/brand/icon-${size}.png`, branding)
}

// The card for link previews of pages without their own image: the logo on
// 1200×630 (see brand.$file.ts).
export function brandOgImageUrl(branding: Pick<Branding, 'logoVersion'>) {
  return versioned('/brand/og.png', branding)
}

// Puts the site's name into copy that has a `{name}` in it.
export function withSiteName(text: string, branding: Pick<Branding, 'name'>) {
  return text.replaceAll('{name}', branding.name)
}

// The <style> element in every page's <head> that holds the site's theme.
export const siteThemeStyleId = 'site-theme'

export function useBranding() {
  return useLoaderData({ from: '__root__', select: (data) => data.branding })
}

// The branding from the root route's loader data, for a route's head().
export function brandingFrom(matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>) {
  const root = matches.find((match) => match.routeId === '__root__')?.loaderData as { branding?: Branding } | undefined
  return root?.branding ?? defaultBranding
}

// A page's <title>: "Likes · <site name>".
export function pageTitle(matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>, title: string) {
  return `${title} · ${brandingFrom(matches).name}`
}
