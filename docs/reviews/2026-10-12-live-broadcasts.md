# Code review: live broadcasts, 12 October 2026

A `/code-review` of the live broadcasting work (OBS → MediaMTX, live page, chat, Go live dialog, recording → episode) and the database changes that went with it (site settings as key/value rows, visitor salt in `site_settings`, sign-in tables in the `auth` schema).

Reviewed on `develop` at `524b200` ("Basic live pages added and db refactoring") plus the uncommitted changes in the working tree at the time. Nothing below has been fixed yet. Line numbers are from that state and may drift.

Findings are ordered most severe first. Tick them off as they're fixed or deliberately left.

---

## 1. Ending a show can take the next stream's recording

- [ ] **`src/server/live.server.ts:288`, `endBroadcast`**

`endBroadcast` trusts `interruptedAt`, which can be up to one poll (5 s) old, and starts `finishRecording` straight away. If OBS has already reconnected, the episode picks up the new stream's file while MediaMTX is still writing it, and then deletes it.

**Scenario:** the stream drops and the poller sets `interruptedAt`. OBS reconnects 2 s later, before the next poll. The owner clicks "Yes, end the show". `closeBroadcast` ends the row and `finishRecording` runs at once. `broadcastRecordings` keeps every file whose mtime is at least `startedAt − 60 s`, which includes the segment MediaMTX is writing now. `joinAudio` reads a partial file, then `rm` deletes it, so the next broadcast's recording is lost or corrupted.

## 2. The 5-minute grace makes every normal stop look like an interruption

- [ ] **`src/server/live.server.ts:29`, `reconnectGraceMs`**

Raising `reconnectGraceMs` from 30 s to 5 minutes means every normal OBS stop is treated as an interruption. The broadcast stays open for 5 minutes, and a new stream started in that window is merged into the old broadcast.

**Scenario:** the owner stops OBS from the manage page or another tab, so `LiveEndDialog` (which only mounts on `/live/$slug`) is never shown. For 5 minutes the public podcast page shows "Live now" and "Watch live", and the episode from the recording is delayed by 5 minutes. A second show started 3 minutes later continues the first broadcast, keeps the first title, and both recordings are joined into one episode.

## 3. The manage page's redirect throws away the owner's work

- [ ] **`src/routes/_authed/podcasts/$slug.manage.tsx:55`, `useLiveStart` → `navigate`**

The manage page sends the owner to `/live/$slug` as soon as a broadcast starts, throwing away whatever they were doing on the page, including uploads that are still running.

**Scenario:** the owner has the Edit dialog open with unsaved changes, or a NewEpisode/BulkUpload upload in progress, and starts OBS (or someone else uses the stream key). The status event calls `navigate()`, the route unmounts, the form state is lost and the upload request is cut off.

## 4. Recording joins are no longer run one at a time

- [ ] **`src/server/live.server.ts:263`, `closeBroadcast` → `void finishRecording(...)`**

`finishRecording` is now fire-and-forget (`void`) instead of being awaited inside the single-flight `syncSafely`, so several recording joins and later polls can run at the same time.

**Scenario:** several broadcasts end on the same poll, or the owner ends one while the poller ends another. Several long ffmpeg `joinAudio` runs start in parallel and overlap later syncs. The single-flight guard in `syncSafely` no longer limits this work, and an error after the sync has finished is only reported, never sequenced.

## 5. The reconnect update can write to a broadcast that has already ended

- [ ] **`src/server/live.server.ts:234`, reconnect branch of `syncLiveBroadcasts`**

The update in the reconnect branch has no `isNull(endedAt)` guard. A poll that read `open` before the owner's `endBroadcast` can write `lastSeenAt` to a row that has already ended, and publish a spurious "reconnected" status.

**Scenario:** `syncLiveBroadcasts` reads `open` with an interrupted broadcast in it. The owner ends it while the poll is running, and the stream reappears in that poll's MediaMTX listing. The poller sets `lastSeenAt = now` and `interruptedAt = null` on the ended row (so `endedAt` is now earlier than `lastSeenAt`), logs "Broadcast reconnected" and sends a status event. The new broadcast only opens on the following poll.

## 6. An interrupted broadcast still shows as "Live now" outside the live page

- [ ] **`src/routes/podcasts/$slug.tsx:107`, plus `useLiveStart` and `fetchMyPodcast`**

`useLiveStart` and `fetchMyPodcast` treat any open broadcast as live (`broadcast !== null`). An interrupted broadcast therefore still shows the red "Live now" badge and the "Watch live" button, while the live page itself shows "Reconnecting…".

**Scenario:** during the interruption window (up to 5 minutes, and see finding 2: after every normal stop), the podcast page, the manage page's `GoLiveButton` and the Go live dialog's badge all say "Live now" while there is no stream. Visitors who click through get "The stream has stopped".

## 7. The end-show dialog lets you end the show twice

- [ ] **`src/components/live-end-dialog.tsx:43`, `end()`**

After `endMyBroadcast` succeeds, `ending` is reset and the dialog stays open with its buttons enabled until the SSE status event arrives. A second click hits `notFound` and shows a misleading error.

**Scenario:** the owner clicks "Yes, end the show", the request succeeds, and the dialog stays open for a moment. The owner clicks again: `endBroadcast` returns false (already ended), the server function throws `notFound`, and the dialog shows "The show couldn't be ended. If the stream came back, it's still live." even though the show did end.

## 8. Page data that's behind the event stream can bring back an ended broadcast

- [ ] **`src/hooks/use-live-events.ts:72`, `useLiveStart`**

`useLiveStart` overwrites the live state from the event stream with the page data's `initiallyLive` whenever that data changes, and closes and reopens the `EventSource`. Page data that is behind the event stream can bring back a broadcast that has ended.

**Scenario:** on the manage page, `useLiveProgress` triggers `router.invalidate`. `fetchMyPodcast` reads `live = true` just before the broadcast ends, after the event stream has already reported `null`. `setLive(true)` puts "Live now" back, and the new `EventSource` starts with `wasLive = true`. The button stays wrong until another status event arrives.

## 9. The live badge is copied in four places

- [ ] **`src/components/go-live-dialog.tsx:134`**, and the same markup in `GoLiveButton`, `src/routes/podcasts/$slug.tsx` and `src/routes/live/$slug.tsx`

The pulsing destructive "Live" badge markup is copied in four places: the Go live dialog, the `GoLiveButton`, the podcast page and the live page.

**Why it matters:** the same Badge, span and class string are repeated. Changing the live indicator (for example adding a "Reconnecting" variant to fix finding 6) means editing four copies. A shared `LiveBadge` component would do the same job.

---

## How the findings connect

- **2 and 6 share a root cause.** Once the grace is long, "stream gone" and "show over" have to be told apart everywhere, not just on the live page. Fixing them together (an explicit interrupted state shown on every page, a shared `LiveBadge` from finding 9, and either a shorter grace or a way to answer the "finished?" prompt from the manage page) is likely simpler than fixing each one alone.
- **1, 4 and 5 are all about how ending a broadcast is coordinated** with the poller and with MediaMTX's files. A fix could:
  - check MediaMTX for the stream again (not the stored `interruptedAt`) before ending;
  - choose segment files by name or time window rather than "changed since start";
  - queue the recording joins one at a time;
  - add the `isNull(endedAt)` guard to the reconnect update.
