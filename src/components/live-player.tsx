import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { Icons } from '~/components/icons'
import { imageSrc } from '~/lib/images'

// How long to wait before trying again when the stream can't be played (it
// may not have reached the server yet, or OBS is reconnecting).
const retryMs = 3000

// The show's live video while `broadcastId` is set, through the app's HLS
// proxy; the artwork and a note while it isn't, saying so if the broadcast
// the page was showing has ended. hls.js is used where the
// browser can play it (most), and the browser's own HLS elsewhere (older iOS).
export function LivePlayer({
  slug,
  broadcastId,
  artwork,
  interrupted = false,
  ended = false,
}: {
  slug: string
  broadcastId: string | null
  artwork: string | null
  // The stream has dropped out, and may come back.
  interrupted?: boolean
  ended?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'loading' | 'playing' | 'waiting'>('loading')

  useEffect(() => {
    const element = video.current
    if (!broadcastId || !element) return
    const src = `/api/shows/${encodeURIComponent(slug)}/live/hls/index.m3u8`
    let hls: Hls | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    setState('loading')

    // Browsers won't start sound without a click; start muted rather than not at all.
    const play = () => {
      element.play().catch(() => {
        element.muted = true
        element.play().catch(() => {})
      })
    }
    const onPlaying = () => setState('playing')
    element.addEventListener('playing', onPlaying)

    async function start() {
      if (stopped) return
      const { default: Hls } = await import('hls.js')
      if (stopped) return
      if (Hls.isSupported()) {
        // Standard HLS in 2s segments, played 3 segments behind live: smooth
        // through Cloudflare and the app's proxy, at a few seconds' delay.
        hls = new Hls({ lowLatencyMode: false, liveSyncDurationCount: 3, backBufferLength: 30 })
        hls.on(Hls.Events.MANIFEST_PARSED, play)
        hls.on(Hls.Events.ERROR, (_event, error) => {
          if (!error.fatal) return
          if (error.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls?.recoverMediaError()
            return
          }
          // Not there yet, or gone for a moment: start over shortly.
          setState('waiting')
          hls?.destroy()
          hls = null
          retry = setTimeout(() => void start(), retryMs)
        })
        hls.loadSource(src)
        hls.attachMedia(element!)
      } else if (element!.canPlayType('application/vnd.apple.mpegurl')) {
        element!.src = src
        element!.addEventListener('loadedmetadata', play, { once: true })
        element!.addEventListener(
          'error',
          () => {
            setState('waiting')
            retry = setTimeout(() => void start(), retryMs)
          },
          { once: true },
        )
        element!.load()
      }
    }
    void start()

    return () => {
      stopped = true
      clearTimeout(retry)
      element.removeEventListener('playing', onPlaying)
      hls?.destroy()
      element.removeAttribute('src')
      element.load()
    }
  }, [slug, broadcastId])

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted shadow-lg ring-1 ring-border">
      {broadcastId ? (
        <>
          <video ref={video} className="size-full" controls playsInline autoPlay />
          {interrupted ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/80 text-center text-foreground">
              <p className="font-medium">The stream has stopped</p>
              <p className="text-sm text-muted-foreground">Waiting for the host to reconnect…</p>
            </div>
          ) : (
            state !== 'playing' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                {state === 'loading' ? 'Starting the stream…' : 'Waiting for the stream…'}
              </div>
            )
          )}
        </>
      ) : (
        <div className="relative flex size-full flex-col items-center justify-center gap-3 text-foreground">
          {artwork && (
            <img
              src={imageSrc(artwork, 192)}
              alt=""
              aria-hidden
              className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-2xl"
            />
          )}
          <Icons.broadcast className="relative size-10 opacity-80" />
          <p className="relative font-medium">{ended ? 'This broadcast has ended' : 'Not live right now'}</p>
          <p className="relative text-sm text-muted-foreground">
            {ended
              ? 'Thanks for watching! The next broadcast will start playing here.'
              : 'This page starts playing when the broadcast begins.'}
          </p>
        </div>
      )}
    </div>
  )
}
