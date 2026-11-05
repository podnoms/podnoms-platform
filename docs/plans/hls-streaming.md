# Plan: keep original audio, stream it as adaptive HLS

Status: phases 1–3 and 5 built (2026-11-05), with the recommended answer to every decision below. Phase 4 is built on the platform side (`hlsUrl` in the mobile API); the app itself still plays `audioUrl`. Phase 6 isn't started.

Where the build differs from this draft:

- **The entry playlist** is a fixed address, `/api/episodes/<id>/hls/master.m3u8`, rather than a URL carried in every episode's data. Players derive it from the episode's id, and fall back to the MP3 on a 404, so no page or query needed changing. It also queues a build for an episode without a stream, so old episodes are built on first play as well as by the backfill.
- **On a 403 or any other failure** the player falls back to the MP3 at its position, rather than fetching a new signed URL.
- **The backfill** runs once per server start from the show page (as the waveform backfill does), behind every other build, rather than as a BullMQ job, so it works without Redis.
- **Lossless masters** get every bitrate, whatever their bitrate: a FLAC's bitrate says how well it compressed, not how good it is.

## Why

Today every episode is one MP3 (`MEDIA_DIR/audio/<id>.mp3`), made by `convertToMp3` and served whole, with Range support, by `/api/episodes/$id/audio`. That has three problems:

- **Quality is lost on the way in.** The download or upload is deleted once the MP3 is made, so the best copy we ever hold is the MP3. Until the change to 320k CBR, anything that wasn't already MP3 came out at about 130 kbps (`-q:a 5`).
- **One bitrate for everyone.** A listener on weak mobile signal gets the same file as one on fibre.
- **Seeking costs a round trip to the app.** Every jump outside the buffered part is a new range request on a file no cache in front of us will hold.

## What we want

1. **Keep the original.** Hold each episode's audio as it arrived, at whatever bitrate, and make everything else from it.
2. **Adaptive streaming for our own players.** The site's player, the embed and the mobile app play HLS: an `.m3u8` master playlist listing a few bitrates, each cut into short segments. The player picks a bitrate and switches as the connection changes.
3. **A single file for podcast apps.** RSS enclosures stay one downloadable file. Apple Podcasts, Overcast, Pocket Casts and the rest don't play HLS from a feed.
4. **Not tied to any CDN.** Correct with no CDN at all, and cacheable by any CDN or caching proxy (Cloudflare, Bunny, Fastly, a caching nginx) using standard HTTP alone. No purge APIs, no CDN-specific tokens or headers.

## Design

### Files

All under `MEDIA_DIR`. Paths are built only in `storage.server.ts`, as now.

| Path | What | Made from |
| --- | --- | --- |
| `masters/<episode id>.mka` | The source's first audio track, **copied, not re-encoded**, in Matroska (which holds any codec). Video is dropped. | The download, upload or joined live recording |
| `audio/<episode id>.mp3` | The feed's enclosure, unchanged in role. MP3 masters are copied; anything else is encoded at 320k CBR (`mp3Bitrate`). | The master |
| `hls/<episode id>/<version>/` | `master.m3u8`, plus per bitrate `<rendition>/index.m3u8`, `init.mp4` and `seg-NNNNN.m4s` | The master |

- **Masters.** `joinAudio` already does this for live recordings, so it becomes the general step. Uploads stop being deleted after conversion: their audio track becomes the master. For the ~9,300 existing episodes the master is simply their current MP3. Nothing better exists for them (see Backfill).
- **`<version>`** is a random id made each time the HLS is built: first build, replaced audio, or a show or episode going private (see Privacy). Every URL under it is therefore immutable, and nothing ever needs purging. A new version is just a new URL, and the old directory is deleted after a grace period (a day), so players mid-episode finish cleanly.

### Bitrates

- **Codec: AAC-LC in fMP4 (CMAF) segments.** Every browser plays it through hls.js, and Safari, iOS and Android play it natively. Opus would be more efficient but Apple's HLS support for it is uneven.
- **Ladder: 96k, 160k and 256k stereo.** Mono sources get mono renditions at half those rates.
- **Never upscale.** Renditions above the master's bitrate are skipped, but the lowest is always made. A 40k mono talk show gets one rendition; a 320k mix gets all three.
- **6-second segments**, VOD playlists (`#EXT-X-PLAYLIST-TYPE:VOD`).
- **One ffmpeg run per episode.** `-f hls -hls_segment_type fmp4 -hls_time 6 -hls_playlist_type vod` with `-var_stream_map` and `-master_pl_name` writes every rendition and the master playlist together. It's audio only, so it runs much faster than real time. Progress is reported with the same `-progress` parsing `convertToMp3` uses.

### Serving

A new route, `/api/episodes/$id/hls/$version/$`, serves files only from that episode's current version directory. Its rules:

- **File names are validated** against a fixed pattern, as the live HLS proxy's `hlsFileName` does, so there's no path traversal.
- **The wrong or an old version gives 404** once its grace period has passed.
- **Content types:** `application/vnd.apple.mpegurl` for playlists, `audio/mp4` for `init.mp4` and segments.
- **It never records a download.** Plays come from the players' activity reports, as now. Downloads stay counted only on the enclosure endpoint, which keeps today's rules.
- **`/api/episodes/$id/audio` is unchanged** and keeps serving the MP3, for feeds, download links and any player without HLS.

### Caching (CDN agnostic)

Caching is controlled only with standard `Cache-Control`. The versioned paths are what make that safe.

| Episode | Header on playlists and segments |
| --- | --- |
| Listed (published, public show, not private) | `Cache-Control: public, max-age=31536000, immutable, s-maxage=86400` |
| Private, or a private show (signed path, below) | `Cache-Control: private, max-age=86400` |

- **Browsers** keep segments for a year. Seeking back to anything already fetched then needs no request at all.
- **Shared caches** keep a public copy for at most a day (`s-maxage`). That bounds how long a URL from before an episode went private can still be served from a cache we don't control, without our having to purge anything.
- **ETag and Last-Modified** are sent from the file's stat. HEAD is answered too.
- **No CDN?** Everything still works, and browser caching alone gives most of the seek improvement.

### Privacy

Cookies and feed keys can't be relied on here. hls.js and native players fetch segments without our app's help, and the mobile app's player can't easily add an `Authorization` header to every segment request.

So private episodes, and every episode of a private show, use a **signed path segment**:

```text
/api/episodes/<id>/hls/<version>/s/<expires>.<hmac>/master.m3u8
```

- **Relative URIs inherit the signature.** Playlists list children relatively (`160k/index.m3u8`, `seg-00001.m4s`), so every child request carries the same signature and no playlist rewriting is needed.
- **The signature is an HMAC** over episode id, version and expiry, with a key from `secrets.server.ts` (a new purpose, e.g. `podnoms-hls`). It's issued only to someone who passes today's checks: owner session, mobile token or feed key, as `getEpisodeAudio` does.
- **Lifetime is 24 hours.** On a 403 the player fetches a fresh URL from the episode's data and resumes at its position.
- **The unsigned path refuses private episodes.**
- **Going private bumps `<version>`.** Copies of the old public URLs then stop at the origin at once, and fall out of shared caches within `s-maxage`.

### Players

**Website** (`player-provider.tsx` and the embed route; the share page uses `PlayerProvider`):

- **One `<audio>` element stays.** On Safari it gets the `.m3u8` directly (`canPlayType('application/vnd.apple.mpegurl')`).
- **Elsewhere hls.js attaches to the element.** It's loaded with a dynamic `import('hls.js')`, as `live-player.tsx` already does.
- **Episodes without HLS yet** keep using the MP3 URL.
- **Unaffected:** waveform, seek, queue, playback positions and the play reports to `/api/episodes/$id/activity` stay as they are, since they work on the element.

**Mobile app** (`/srv/dev/podnoms/podnoms-mobile`, a separate project):

- **API shapes:** add `hlsUrl` (absolute, signed where needed) next to `audioUrl` in `mobile-api.server.ts`. Keep `src/lib/api-types.ts` in step.
- **Playback:** the app plays episodes with `expo-audio`, which plays HLS natively (AVPlayer, ExoPlayer). Use `hlsUrl` when present, `audioUrl` otherwise. That covers `src/lib/auto.ts` (car playback) too.
- **Downloads:** downloads for offline listening keep using `audioUrl`.

### Processing

In `episode-processor.server.ts`, still one job at a time:

1. **Download, upload or live recording**, then write the master (`-map 0:a:0 -c:a copy`, Matroska).
2. **Make the MP3 from the master.** The episode becomes `ready` here, as today.
3. **Build the HLS from the master**, then set `episode.hlsVersion`.
4. **Waveform**, as now.

- **A failed HLS build doesn't fail the episode.** It's reported with `reportError`, the episode plays from the MP3, and the backfill retries it.
- **Replacing audio** builds a new master, MP3 and HLS version alongside the current ones, then swaps, as replacement audio already works for the MP3.
- **Uploads skip the download throttle,** as now. Only fetching from platforms goes through it.

### Database

Additive migration on `episode`:

- `hlsVersion text` (null = no HLS yet)
- `masterCodec text`
- `masterBitrate integer`
- `masterChannels integer` (the last three drive the ladder and admin display)

### Housekeeping

- **`media-cleanup`** learns `masters/` and `hls/`. It keeps the current version directory and removes old ones after the grace period.
- **Deleting** an episode removes its master and HLS directory with its MP3. Show deletion's manifest and the `show-archive` job move them into `deleted/<show id>/` with the rest.
- **Stale staged uploads** are still cleared after a day. Only an upload that became an episode is kept, as its master.

### Backfill

- **A `hls-backfill` job** (BullMQ) builds HLS for existing episodes from their current MP3, newest first.
- **It never delays real work.** It only takes the processor when nothing else is queued.
- **A show page load** also queues any of its missing HLS builds, as waveforms are backfilled now (`fetchMyShow`).
- **This improves seeking for old episodes, not their quality.** Their originals are gone.
- **Optional later phase:** re-download link episodes from `sourceUrl` to get real masters. This must go through the download throttle, so it would take weeks, and links that have since disappeared would be skipped.

## Costs

- **Storage per hour of audio**, roughly: MP3 at 320k is ~144 MB, and HLS at 96+160+256k is ~230 MB. The master is ~60–150 MB for a typical download (Opus/AAC/MP3), but up to ~600 MB for an uploaded WAV or FLAC. Expect 3–4× today for new episodes, and less for old ones, which only gain HLS.
- **CPU:** one extra ffmpeg run per episode, audio only. It's small next to the download time for link episodes.
- **Free accounts:** `freeAudioHours` counts hours, so it's unaffected. Masters could be paid-only (see Decisions).

## Phases

Each phase ships on its own.

1. **Masters.** Keep the original audio for new episodes, and make the MP3 from it. No visible change.
2. **HLS build and serving.** Packaging, the new route, signed paths, cache headers, `hlsVersion`, housekeeping.
3. **Web player.** hls.js or native HLS with MP3 fallback, plus refreshing signed URLs.
4. **Mobile.** `hlsUrl` in the mobile API, then the app change in `podnoms-mobile`.
5. **Backfill** of existing episodes.
6. **Optional:** re-fetch link episodes for real masters.

## Tests

- **`tests/server/hls.server.test.ts`** (real ffmpeg, `hasFfmpeg`): it should check that playlists parse, that renditions above the source bitrate are skipped, that mono stays mono, and that durations match.
- **Route tests** with `callRoute()`: they should cover public cache headers, 404 for a wrong or old version, refused traversal names, and private episodes refusing the unsigned path. A valid signature should play, and an expired or forged one should get 403.
- **Housekeeping tests:** `media-cleanup` should keep the current version and drop old ones. The show-deletion manifest should include masters and HLS.
- **Processor tests:** an HLS failure should leave the episode ready, with MP3 only.

## Decisions needed

1. **The master: the untouched audio track (recommended)**, a lossless re-encode, or a 320k copy. The untouched track is the best quality and usually the smallest. Uploads of WAV or FLAC are the large case.
2. **The bitrates: AAC 96/160/256k, capped at the source (recommended)**, or another set.
3. **The feed file: MP3, copied or encoded at 320k (recommended, as now)**, or M4A/AAC to match the HLS. Some older podcast apps still handle MP3 best.
4. **Old episodes: background backfill plus on page load (recommended)**, backfill only on first play, or leave them on MP3.
5. **Masters for everyone (recommended)** or only for paid accounts.
6. **Signed URL lifetime: 24 hours (recommended).**
