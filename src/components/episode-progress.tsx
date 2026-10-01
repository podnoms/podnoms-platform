import { Progress } from '~/components/ui/progress'
import { formatBytes, formatTimeLeft } from '~/lib/format'
import type { EpisodeProgress as ProgressInfo } from '~/server/episode-processor.server'

export const stageLabels: Record<ProgressInfo['stage'], string> = {
  queued: 'Queued',
  fetching: 'Fetching details',
  downloading: 'Downloading',
  converting: 'Converting',
}

// A progress bar and one line of detail for an episode that's being processed.
export function EpisodeProgress({ progress }: { progress: ProgressInfo | null }) {
  if (!progress) {
    return <p className="text-sm text-muted-foreground">Waiting for the server to pick this up…</p>
  }
  if (progress.stage === 'downloading') {
    const { downloadedBytes, totalBytes, bytesPerSecond, secondsLeft } = progress
    const percent = totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : null
    const detail = [
      totalBytes ? `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}` : formatBytes(downloadedBytes),
      bytesPerSecond ? `${formatBytes(bytesPerSecond)}/s` : null,
      secondsLeft != null ? formatTimeLeft(secondsLeft) : null,
    ].filter(Boolean)
    return (
      <div className="flex w-full flex-col gap-1.5">
        <div className="flex gap-2 text-sm text-muted-foreground">
          <span>Downloading{percent != null && ` · ${Math.floor(percent)}%`}</span>
          <span className="ml-auto text-right tabular-nums">{detail.join(' · ')}</span>
        </div>
        <Progress value={percent ?? 0} />
      </div>
    )
  }
  if (progress.stage === 'converting' && progress.percent != null) {
    return (
      <div className="flex w-full flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">Converting to MP3 · {progress.percent}%</p>
        <Progress value={progress.percent} />
      </div>
    )
  }
  const text = {
    queued:
      progress.stage === 'queued' && progress.ahead > 0
        ? `Waiting to start · ${progress.ahead} ahead in the queue`
        : 'Starting…',
    fetching: 'Fetching video details…',
    converting: 'Downloaded · converting to MP3…',
  }[progress.stage]
  return (
    <div className="flex w-full flex-col gap-1.5">
      <p className="text-sm text-muted-foreground">{text}</p>
      <Progress value={progress.stage === 'converting' ? 100 : 0} className={progress.stage === 'converting' ? 'animate-pulse' : undefined} />
    </div>
  )
}
