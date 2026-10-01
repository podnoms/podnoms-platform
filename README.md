# PodNoms

Turn YouTube videos, Mixcloud and SoundCloud uploads, or your own audio files into a podcast you can subscribe to in any podcast app.

Paste a link or upload a file. PodNoms downloads or converts it to MP3 in the background and publishes it in the podcast's RSS feed.

## Features

- **Episodes from links:** any source [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports, with live download progress.
- **Episodes from files:** upload audio (MP3, M4A, WAV, FLAC…) or a video to take the audio from, up to 1 GB.
- **RSS feeds:** one per podcast at `/feed/<slug>`, with the iTunes tags podcast apps expect.
- **Artwork:** for podcasts and episodes, stored as square JPEGs that meet Apple's artwork rules. Resized copies are served on request.
- **Rich text descriptions:** edited in the browser and sanitised on the server.
- **Built-in player:** keeps playing as you move between pages and remembers where you left off on each episode, on any device.
- **Sign-in:** email and password, or GitHub, Google or Facebook.

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React 19, Vite, Nitro) with Tailwind CSS and shadcn/ui
- PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)
- [Auth.js](https://authjs.dev/) (`@auth/core`)
- yt-dlp and ffmpeg for audio, [sharp](https://sharp.pixelplumbing.com/) for images, [Tiptap](https://tiptap.dev/) for rich text

## Requirements

- [Bun](https://bun.sh/) for installing packages and running scripts. The production server runs on Node.js 22.9 or later.
- PostgreSQL
- `yt-dlp`, `ffmpeg` and `ffprobe` on your `PATH`, or set their locations in `.env`

## Getting started

```sh
bun install
cp .env.example .env    # then fill it in (see below)
bun run db:migrate      # create the database tables
bun run _dev            # http://localhost:5173
```

`bun run dev` also starts an HTTPS proxy on port 3000. It uses certificate paths specific to the maintainer's machine, so use `bun run _dev` unless you change them in `package.json`.

## Configuration

Settings are read from `.env` and checked at startup by [`src/env.ts`](src/env.ts). See [`.env.example`](.env.example) for the full list.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string |
| `AUTH_SECRET` | Yes | At least 32 characters; generate one with `openssl rand -base64 32` |
| `AUTH_URL` | In production | Public base URL, e.g. `https://podnoms.com`. Used for sign-in callbacks and for the absolute links in RSS feeds. |
| `MEDIA_DIR` | No | Where all media is stored (default `./media`) |
| `YTDLP_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH` | No | Paths to the binaries (default: found on `PATH`) |
| `AUTH_GITHUB_ID` / `_SECRET`, `AUTH_GOOGLE_ID` / `_SECRET`, `AUTH_FACEBOOK_ID` / `_SECRET` | No | Each sign-in provider is enabled when both of its values are set. The OAuth callback URL is `<AUTH_URL>/api/auth/callback/<provider>`. |

### Media folder

Everything PodNoms stores on disk lives under `MEDIA_DIR`:

```
media/
  audio/            episode MP3s
  images/           artwork, as JPEGs
  images/variants/  resized copies, made on request (safe to delete)
  sources/          uploaded files waiting to be converted
  uploads/          audio uploads not yet added as episodes (cleared after a day)
  staged-images/    image uploads not yet saved (cleared after a day)
```

Back it up along with the database.

## Scripts

| Script | What it does |
| --- | --- |
| `bun run _dev` | Starts the development server |
| `bun run build` | Builds for production into `.output/` |
| `bun run start` | Runs the production build, loading `.env` if present |
| `bun run typecheck` | Type-checks the project |
| `bun run db:generate` | Generates a migration from changes to [`src/server/db/schema.ts`](src/server/db/schema.ts) |
| `bun run db:migrate` | Applies pending migrations |
| `bun run db:studio` | Opens Drizzle Studio to browse the database |

## Deployment

`bun run build` produces a Node.js server in `.output/`. Run it with `bun run start`, or `node .output/server/index.mjs`. Set `NITRO_PRESET` at build time to target another platform.

Things to know:

- **Processing:** episodes are processed one at a time, in the server process. Run a single instance; a job queue would be needed to run several.
- **Media folder:** the server needs `yt-dlp` and `ffmpeg`, and a `MEDIA_DIR` that survives restarts and redeploys.
- **Image library binaries:** sharp uses native binaries for the platform it was installed on. Build on the same OS and CPU architecture you deploy to, or run `bun install` there.
- **Upload size:** audio uploads are sent as a single request of up to 1 GB, so allow request bodies that large in any reverse proxy in front of the app.

## License

[MIT](LICENSE) © 2026 Fergal Moran
