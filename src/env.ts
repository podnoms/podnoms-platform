import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

// Validated environment variables. Server variables throw if read on the
// client; client variables must be prefixed with VITE_.
export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    // Where all media (episode audio, images, uploads) is kept. Relative paths
    // are from the project root.
    MEDIA_DIR: z.string().default('media'),
    YTDLP_PATH: z.string().default('yt-dlp'),
    FFMPEG_PATH: z.string().default('ffmpeg'),
    FFPROBE_PATH: z.string().default('ffprobe'),
    AUTH_SECRET: z.string().min(32),
    // The site's public address, e.g. https://podnoms.com: for links in emails
    // sent in the background, and for every absolute URL when a proxy in front
    // of the app doesn't pass on the original protocol and host.
    // Sign-in (Auth.js) uses it too, so there's no AUTH_URL.
    SITE_URL: z.url().optional(),
    // OAuth providers are enabled only when both of their values are set.
    AUTH_GITHUB_ID: z.string().optional(),
    AUTH_GITHUB_SECRET: z.string().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    AUTH_FACEBOOK_ID: z.string().optional(),
    AUTH_FACEBOOK_SECRET: z.string().optional(),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
    // Errors are sent to this Sentry-compatible DSN (e.g. a self-hosted
    // GlitchTip project) when it is set.
    SENTRY_DSN: z.url().optional(),
    // Redis for the job queue (see jobs.server.ts). Without it, scheduled jobs
    // such as the media clean-up don't run.
    REDIS_URL: z.url().optional(),
    // Pexels API key (free, from pexels.com/api) for the "Random image"
    // button on artwork. Without it, photos come from Openverse, which needs no key.
    PEXELS_API_KEY: z.string().optional(),
    // A MaxMind account (free, from maxmind.com/en/geolite2/signup) for the
    // GeoLite2 database that places listeners by country, region and city.
    // Without them, activity is recorded without a location.
    MAXMIND_ACCOUNT_ID: z.string().optional(),
    MAXMIND_LICENSE_KEY: z.string().optional(),
    // Where signed-in users can donate, shown in the top nav's Donate menu.
    // Without either, there's no menu.
    KOFI_URL: z.url().optional(),
    BITCOIN_ADDRESS: z.string().optional(),
    // An invite link to the community Discord server, shown in the top nav.
    DISCORD_SERVER: z.url().optional(),
    // Search engines' site-ownership tokens (the content of their verification
    // meta tag), for Google Search Console and Bing Webmaster Tools.
    GOOGLE_SITE_VERIFICATION: z.string().optional(),
    BING_SITE_VERIFICATION: z.string().optional(),
    // A Podcast Index API key with write access (free, from api.podcastindex.org),
    // for submitting podcasts to it with one click. Without it, owners add
    // their feed on podcastindex.org themselves.
    PODCASTINDEX_API_KEY: z.string().optional(),
    PODCASTINDEX_API_SECRET: z.string().optional(),
    // An SMTP server for email (password resets, notifications). When
    // SMTP_HOST is set these are used, and the admin page's email settings
    // can't be changed; otherwise admins can enter them there.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    // "true" for TLS from the start (usually port 465); otherwise STARTTLS is
    // used when the server offers it.
    SMTP_SECURE: z.stringbool().default(false),
    // Who emails come from, e.g. "podnoms <hello@podnoms.com>".
    EMAIL_FROM: z.string().optional(),
  },
  clientPrefix: 'VITE_',
  client: {},
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
