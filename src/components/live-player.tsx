import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { Icons } from '~/components/icons'
import { imageSrc } from '~/lib/images'

// How long to wait before trying again when the stream can't be played (it
// may not have reached the server yet, or OBS is reconnecting).
const retryMs = 3000

// The podcast's live video while `broadcastId` is set, through the app's HLS
// proxy; the artwork and a note while it isn't. hls.js is used where the
// browser can play it (most), and the browser's own HLS elsewhere (older iOS).
export function LivePlayer({
  slug,
  broadcastId,
  artwork,
}: {
  slug: string
  broadcastId: string | null
  artwork: string | null
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'loading' | 'playing' | 'waiting'>('loading')

  useEffect(() => {
    const element = video.current
    if (!broadcastId || !element) return
    const src = `/api/podcasts/${encodeURIComponent(slug)}/live/hls/index.m3u8`
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
        hls = new Hls({ lowLatencyMode: true, backBufferLength: 30 })
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
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-lg ring-1 ring-black/10">
      {broadcastId ? (
        <>
          <video ref={video} className="size-full" controls playsInline autoPlay />
          {state !== 'playing' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/80">
              {state === 'loading' ? 'Starting the stream…' : 'Waiting for the stream…'}
            </div>
          )}
        </>
      ) : (
        <div className="relative flex size-full flex-col items-center justify-center gap-3 text-white">
          {artwork && (
            <img
              src={imageSrc(artwork, 192)}
              alt=""
              aria-hidden
              className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-2xl"
            />
          )}
          <Icons.broadcast className="relative size-10 opacity-80" />
          <p className="relative font-medium">Not live right now</p>
          <p className="relative text-sm text-white/70">This page starts playing when the broadcast begins.</p>
        </div>
      )}
    </div>
  )
}
