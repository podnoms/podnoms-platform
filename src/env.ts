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
    // Public base URL of the app. Only needed when it can't be inferred from the request.
    AUTH_URL: z.url().optional(),
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
  },
  clientPrefix: 'VITE_',
  client: {},
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
