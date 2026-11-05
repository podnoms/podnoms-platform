// The site's identity (name, logo, copy, theme, analytics), which admins set
// on the Branding and Theme tabs at /admin so one image can run several differently branded sites. The
// root route loads it (see fetchBranding); this module is shared by client and
// server. Anything left unset is the default below.
import { useLoaderData } from '@tanstack/react-router'
import { isCustomDomain } from '~/lib/current-domain'
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
  heroTitle: 'Robot powered *shows*.',
  heroText:
    'Upload your recordings, go live, or pull in episodes from YouTube, Mixcloud and SoundCloud. {name} gives your show its own page, its own feed and listeners who follow along.',
  stepsTitle: 'How it works',
  steps: [
    {
      title: 'Create your show',
      description: 'Give it a name, artwork and a description. It gets its own page and its own address.',
    },
    {
      title: 'Add episodes your way',
      description:
        'Upload audio or video, record a live broadcast, or paste a link. Conversion, artwork and details are handled for you.',
    },
    {
      title: 'Grow your audience',
      description:
        'Listeners follow, like and comment on {name}, and subscribe in whatever podcast app they already use.',
    },
  ],
  featuresTitle: 'Everything your show needs',
  featuresText: 'Whether it’s a weekly talk show, your DJ sets or a feed of things you want to hear.',
  features: [
    {
      title: 'Bring your own audio',
      description: 'Upload audio or video files from your own machine and they’re turned into podcast-ready episodes.',
    },
    {
      title: 'Go live',
      description: 'Stream from OBS with live chat, and the recording becomes an episode when you finish.',
    },
    {
      title: 'In every podcast app',
      description: 'A standard RSS feed for Apple Podcasts, Pocket Casts, Overcast, AntennaPod and the rest.',
    },
    {
      title: 'Your page, your look',
      description: 'A public page with a waveform player, an embed for your site, your own theme and your own domain.',
    },
    {
      title: 'Listeners who stick around',
      description: 'Followers hear about new episodes, and can like, comment at a moment in the episode and share.',
    },
    {
      title: 'Or paste a link',
      description:
        'Turn a YouTube video, Mixcloud mix or SoundCloud track into an episode, or follow a whole channel and new uploads arrive on their own.',
    },
  ],
  exploreTitle: 'Listen on {name}',
  exploreText: 'Shows people have made here, for anyone to listen to.',
  ctaTitle: 'Start your show today',
  ctaText: 'Create a show, add your first episode, and share it with the world.',
}

export const defaultBranding: Branding = {
  name: 'podnoms',
  tagline: 'Robot powered shows',
  description:
    'Make your own show from your recordings, live broadcasts, or YouTube, Mixcloud and SoundCloud links, with its own page and RSS feed.',
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
  // A show's own domain doesn't name the site.
  if (isCustomDomain()) return title
  return `${title} · ${brandingFrom(matches).name}`
}
