import type { ReportedActivity } from '~/lib/activity-schema'

// Omit, for each kind of activity.
type WithoutReferrer<T> = T extends unknown ? Omit<T, 'referrer'> : never

// Tells the server about a play or share, for the podcast's stats. Best
// effort: it's sent even as the page closes, and failures are ignored. The
// page's own referrer goes with it, as the request's would name this site.
export function reportActivity(episodeId: string, activity: WithoutReferrer<ReportedActivity>) {
  if (typeof window === 'undefined') return
  void fetch(`/api/episodes/${encodeURIComponent(episodeId)}/activity`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...activity, referrer: document.referrer || undefined }),
    keepalive: true,
  }).catch(() => {})
}
