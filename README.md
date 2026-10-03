# PodNoms

[![CI: tests, Docker build and publishing](https://github.com/podnoms/podnoms-platform/actions/workflows/docker.yml/badge.svg?event=push)](https://github.com/podnoms/podnoms-platform/actions/workflows/docker.yml)

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
| `LOG_LEVEL` | No | `trace`, `debug`, `info` (default), `warn`, `error`, `fatal` or `silent` |
| `REDIS_URL` | No | Redis for background jobs, e.g. `redis://localhost:6379`. Without it, scheduled jobs (such as the media clean-up) don't run. See [Background jobs](#background-jobs). |
| `PEXELS_API_KEY` | No | A free [Pexels API key](https://www.pexels.com/api/). The **Random image** button on podcast and episode artwork searches for a photo using the title, description and podcast title: on Pexels with this key, otherwise on [Openverse](https://openverse.org) (public-domain and CC0 photos only, no key needed, up to 200 searches a day). |
| `SENTRY_DSN` | No | Sentry-compatible DSN (e.g. a GlitchTip project) that server and browser errors are reported to. See [Logs and errors](#logs-and-errors). |

### Media folder

Everything PodNoms stores on disk lives under `MEDIA_DIR`:

```text
media/
  audio/            episode MP3s
  images/           artwork, as JPEGs
  images/variants/  resized copies, made on request (safe to delete)
  waveforms/        episode waveforms, as JSON (remade if missing)
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

### Docker Compose

The [Dockerfile](Dockerfile) builds the application and includes Node.js, yt-dlp,
ffmpeg and ffprobe. On each pushed `v*` tag, [GitHub Actions](.github/workflows/docker.yml)
publishes the image to `ghcr.io/podnoms/podnoms-platform` with `latest`, version
(e.g. `0.1.0` and `0.1`) and commit SHA tags. The workflow uses the repository's `GITHUB_TOKEN`; no
registry secret is needed. For a fork, set `PODNOMS_IMAGE` to its GHCR image.

Use Docker Compose 2.20 or later. Copy `.env.example` to `.env`, set `AUTH_SECRET`
to the output of `openssl rand -base64 32`, and set `AUTH_URL` to the public URL
(or `http://localhost:3000` locally). OAuth settings in `.env` are passed through.

**With bundled Postgres:** leave `DATABASE_URL` empty and set `POSTGRES_PASSWORD`
to the output of `openssl rand -hex 24`. Start the `postgres` profile:

```sh
docker compose --profile postgres up -d --pull always
```

Compose creates the database and waits for it to become healthy. Its port is
available only inside the Compose network. Keep the password URL-safe (letters,
digits, `-` or `_`), since it is also used in the generated connection string.

**With external Postgres:** set `DATABASE_URL` to the full connection string,
including any required SSL parameters, and run without the profile:

```sh
docker compose up -d --pull always
```

`POSTGRES_PASSWORD` is unnecessary in this mode. The database must already exist
and the connection must allow schema migrations. Use a hostname reachable from
the container; `localhost` refers to the container itself. Compose may warn that
the optional `postgres` dependency is disabled.

In both modes the container applies pending Drizzle migrations before starting
the server. A failed migration prevents startup. The app is available on port
3000; set `PORT` to change the host port. Media and bundled database data persist
in named volumes across container updates. Back up both; `docker compose down -v`
deletes these volumes. Run only one app instance, as described below.

To build from your checkout instead of pulling the published image:

```sh
PODNOMS_IMAGE=podnoms:local docker compose --profile postgres up -d --build
# Omit --profile postgres when using an external database.
```

To update, repeat the appropriate `up -d --pull always` command. If the GHCR
package is private, authenticate with `docker login ghcr.io` using a token with
`read:packages`, or make the package public for unauthenticated pulls.

### Manually publishing a Docker image

Use [`scripts/create-manual-docker.sh`](scripts/create-manual-docker.sh) to build
your current checkout and push directly to GHCR without waiting for GitHub Actions.
Install Docker with Buildx and sign in once:

```sh
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

At the password prompt, use a [personal access token (classic) with
`write:packages`](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-with-a-personal-access-token-classic)
from an account with write access to the package.

```sh
./scripts/create-manual-docker.sh --dry-run  # preview without building or pushing
./scripts/create-manual-docker.sh           # build and push :latest
./scripts/create-manual-docker.sh hotfix    # push only :hotfix; leaves :latest alone
```

The default image is `ghcr.io/podnoms/podnoms-platform:latest`, matching Compose.
The script builds `linux/amd64`, matching the GitHub Actions runner, and reuses
the local builder's cache. Override `IMAGE_NAME` (without a tag) or `PLATFORM`
if needed, for example `PLATFORM=linux/arm64 ./scripts/create-manual-docker.sh hotfix`.
Building for a different architecture requires a builder that supports it.

Local changes are included subject to `.dockerignore`. This shortcut skips
type-checks and tests and does not bump the version, create Git tags, or trigger
Actions. It publishes only the requested image tag; use the release workflow for
version and commit SHA tags. After pushing `latest`, run the appropriate Compose
`up -d --pull always` command on your server to deploy it.

### Running directly

`bun run build` produces a Node.js server in `.output/`. Run it with `bun run start`, or `node .output/server/index.mjs`. Set `NITRO_PRESET` at build time to target another platform.

Things to know:

- **Processing:** episodes are processed one at a time, in the server process. Run a single instance; a job queue would be needed to run several.
- **Media folder:** the server needs `yt-dlp` and `ffmpeg`, and a `MEDIA_DIR` that survives restarts and redeploys.
- **Image library binaries:** sharp uses native binaries for the platform it was installed on. Build on the same OS and CPU architecture you deploy to, or run `bun install` there.
- **Upload size:** audio uploads are sent as a single request of up to 1 GB, so allow request bodies that large in any reverse proxy in front of the app.

### Background jobs

Jobs are queued in Redis with [BullMQ](https://docs.bullmq.io/) and run by a worker in the app, which starts with the first request. Keys are prefixed `podnoms:`, so the Redis can be shared. With Docker Compose, start the bundled Redis with `--profile redis` and set `REDIS_URL=redis://redis:6379`; it keeps its data on disk so jobs survive restarts.

| Job | When | What it does |
| --- | --- | --- |
| `media-cleanup` | Daily, 03:30 | Removes files in `MEDIA_DIR` that no podcast, episode or user refers to (once they're a day old), uploads and images that were never saved (after a day), and the kept upload of an episode that has been failed for a week, telling its owner to upload it again |

Admins can watch, retry and clean up jobs at `/admin/queues` ([Bull Board](https://github.com/felixmosh/bull-board)), linked from the account menu as **Jobs**.

### Admins

The first user to sign up becomes an admin. On a site that already had users before admins existed, the migration makes the only user an admin; with several, choose one by hand:

```sql
UPDATE "user" SET "isAdmin" = true WHERE email = 'you@example.com';
```

### Logs and errors

The server logs one JSON object per line to stdout (readable, coloured lines under `bun run _dev`). Each line has `level`, `msg`, `time`, `app: "podnoms"` and `version`, plus fields such as `episodeId`, `path`, `status` and `durationMs`. Every request is logged at `info`, except images, episode audio and static assets, which are logged at `debug`. Episode jobs log when they start, finish and fail.

Unexpected errors from routes, server functions, episode jobs, and the process itself are logged at `error`. When `SENTRY_DSN` is set, they are also sent to a Sentry-compatible error tracker. Browser errors are sent there too, using the same DSN, which the server passes to the page at runtime.

[`deploy/observability/`](deploy/observability/) has example configuration for a free, self-hosted setup: Loki and Grafana Alloy to collect the logs for Grafana (with a dashboard and an alert rule), and GlitchTip to track errors. See its [README](deploy/observability/README.md).

## Releases

Use [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`, with Git tags
named `vX.Y.Z`. Use `patch` for fixes, `minor` for new functionality, and `major`
for incompatible changes once the application reaches `1.0.0`. During `0.x`, use
minor releases for potentially breaking changes. Existing `v0.1` and `v0.2` tags
stay as they are; new releases use the three-part version in `package.json`.

Install Git, Node.js, Bun and the [GitHub CLI](https://cli.github.com/), then sign
in with `gh auth login`. Merge the work you want to release into GitHub's default
branch (currently `develop`), check out that branch, and synchronize it with
`origin`. All tracked and untracked changes must be committed or stashed.

```sh
./scripts/create-release.sh --dry-run  # preview the next patch (0.2.0 -> 0.2.1)
./scripts/create-release.sh           # publish the next patch
./scripts/create-release.sh minor     # e.g. 0.2.1 -> 0.3.0
./scripts/create-release.sh major     # e.g. 0.3.0 -> 1.0.0
```

The script installs locked dependencies, type-checks, tests, and builds. It then
uses [`bun pm version`](https://bun.sh/docs/pm/cli/pm#version) to bump
`package.json`, create the commit and annotated tag, then pushes both together
and publishes a GitHub release with
[generated notes](https://cli.github.com/manual/gh_release_create). The pushed
tag also starts the Docker image workflow; image publishing completes separately.
The version-only change does not require a `bun.lock` update.

Dry runs only preview the version and steps; they do not contact GitHub or run
checks. Real releases require permission to push directly to the default branch
and create tags and releases. If branch protection requires pull requests, submit
the version bump through a PR, then tag its merged commit and create the release
with `gh release create <tag> --verify-tag --generate-notes` after pushing the tag.

If publishing fails, the script preserves the local commit/tag and prints retry
commands. Inspect whether the push or GitHub release succeeded before retrying;
do not rerun the normal bump command or move an already published tag.

## License

[MIT](LICENSE) © 2026 Fergal Moran
