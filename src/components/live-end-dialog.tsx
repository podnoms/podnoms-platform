import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { endMyBroadcast } from '~/functions/live'

// For the podcast's owner, when their stream stops coming in: is the show
// over (a lost connection looks the same)? Yes ends it for everyone watching;
// no waits for OBS to reconnect. It closes by itself if the stream comes back,
// and asks again if it drops again.
export function LiveEndDialog({
  broadcast,
  graceMinutes,
}: {
  broadcast: { id: string; interruptedAt: Date | null } | null
  // How long the broadcast waits before ending by itself.
  graceMinutes: number
}) {
  // The interruption the owner answered "not yet" to, so it isn't asked twice.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const interruption = broadcast?.interruptedAt ? `${broadcast.id}@${broadcast.interruptedAt.getTime()}` : null
  const open = interruption !== null && interruption !== dismissed

  async function end() {
    if (!broadcast) return
    setEnding(true)
    setError(null)
    try {
      // Viewers, and this page, hear it has ended through the event stream.
      await endMyBroadcast({ data: { broadcastId: broadcast.id } })
    } catch {
      setError("The show couldn't be ended. If the stream came back, it's still live.")
    } finally {
      setEnding(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && setDismissed(interruption)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Have you finished streaming this show?</AlertDialogTitle>
          <AlertDialogDescription>
            Your stream has stopped coming in. If you've finished, everyone watching will be told the show has ended,
            and the recording becomes a private episode. If not, the show waits for OBS to reconnect, for up to{' '}
            {graceMinutes} minutes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={ending}>No, I'm reconnecting</AlertDialogCancel>
          <AlertDialogAction
            disabled={ending}
            onClick={(event) => {
              // Stays open until it's done, to show an error if it fails.
              event.preventDefault()
              void end()
            }}
          >
            Yes, end the show
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
