// Plays an episode through an <audio> element from its HLS stream (see
// src/server/hls.server.ts), falling back to its MP3 when there's no stream
// (not built yet, or the browser can't play one) or the stream fails part way
// (e.g. its signed URLs expiring after a day), from where it had got to.
// Safari and iOS play HLS themselves; other browsers through hls.js, loaded
// when first needed.
import type Hls from 'hls.js'

// The entry playlist; 404 until the episode's stream is built.
export function hlsEntryPath(episodeId: string) {
  return `/api/episodes/${episodeId}/hls/master.m3u8`
}

type HlsModule = typeof import('hls.js')
let hlsModule: Promise<HlsModule> | null = null
let loadedHls: HlsModule | null = null

// Starts loading hls.js, so it's there by the time something is played.
export function preloadHls() {
  hlsModule ??= import('hls.js').then((module) => (loadedHls = module))
  return hlsModule
}

export type StreamEpisode = { id: string; audioUrl: string }

export type LoadOptions = {
  autoplay: boolean
  // Where to start, if not the beginning.
  startAt?: number
  // Called just before falling back to the MP3, with where it had got to, so
  // the caller can start the MP3 there once it has loaded.
  onFallback?: (seconds: number) => void
}

// Seconds of audio to fetch ahead: little while paused (an episode queued up
// on page load), more once it plays.
const pausedBuffer = 6
const playingBuffer = 30

const nativeHls = (audio: HTMLAudioElement) => audio.canPlayType('application/vnd.apple.mpegurl') !== ''
const mediaSourceSupported = () =>
  typeof window !== 'undefined' && ('MediaSource' in window || 'ManagedMediaSource' in window)

export class EpisodeSource {
  private hls: Hls | null = null
  // The episode playing from its stream, which can still fall back.
  private streaming: { episode: StreamEpisode; options: LoadOptions } | null = null
  private lastTime = 0
  // Bumped on every load, so a load waiting on hls.js knows it's been replaced.
  private generation = 0
  private readonly audio: HTMLAudioElement
  private readonly onTimeUpdate = () => {
    if (this.audio.currentTime > 0) this.lastTime = this.audio.currentTime
  }
  private readonly onPlay = () => {
    if (this.hls) this.hls.config.maxBufferLength = playingBuffer
  }

  constructor(audio: HTMLAudioElement) {
    this.audio = audio
    audio.addEventListener('timeupdate', this.onTimeUpdate)
    audio.addEventListener('play', this.onPlay)
  }

  load(episode: StreamEpisode, options: LoadOptions) {
    this.reset()
    const generation = this.generation
    this.lastTime = options.startAt ?? 0
    const audio = this.audio
    if (nativeHls(audio)) {
      this.streaming = { episode, options }
      audio.src = hlsEntryPath(episode.id)
      if (options.autoplay) void audio.play().catch(() => {})
      return
    }
    if (!mediaSourceSupported()) return this.playMp3(episode, options)
    // Synchronous when hls.js is already loaded, so play() stays inside the
    // click that asked for it.
    if (loadedHls) return this.attachHls(loadedHls, episode, options)
    void preloadHls().then(
      (module) => generation === this.generation && this.attachHls(module, episode, options),
      () => generation === this.generation && this.playMp3(episode, options),
    )
  }

  // Stops loading anything and empties the element.
  unload() {
    this.reset()
    this.audio.removeAttribute('src')
    this.audio.load()
  }

  // Drops the current source's stream, if it has one, and any load waiting
  // on hls.js.
  private reset() {
    this.generation++
    this.hls?.destroy()
    this.hls = null
    this.streaming = null
  }

  // For the element's error handler: true if it was the stream that failed,
  // which has now fallen back to the MP3.
  handleError() {
    if (!this.streaming) return false
    this.fallBack()
    return true
  }

  destroy() {
    this.unload()
    this.audio.removeEventListener('timeupdate', this.onTimeUpdate)
    this.audio.removeEventListener('play', this.onPlay)
  }

  private attachHls({ default: HlsClass }: HlsModule, episode: StreamEpisode, options: LoadOptions) {
    if (!HlsClass.isSupported()) return this.playMp3(episode, options)
    const once = { maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 }
    const hls = new HlsClass({
      startPosition: options.startAt ?? -1,
      maxBufferLength: options.autoplay ? playingBuffer : pausedBuffer,
      // No stream yet is a 404, and the MP3 is the answer to that: don't retry.
      manifestLoadPolicy: {
        default: { maxTimeToFirstByteMs: 10_000, maxLoadTimeMs: 20_000, timeoutRetry: once, errorRetry: once },
      },
    })
    this.hls = hls
    this.streaming = { episode, options }
    let recovered = false
    hls.on(HlsClass.Events.ERROR, (_event, error) => {
      if (!error.fatal) return
      if (error.type === HlsClass.ErrorTypes.MEDIA_ERROR && !recovered) {
        recovered = true
        hls.recoverMediaError()
        return
      }
      this.fallBack()
    })
    if (options.autoplay) hls.on(HlsClass.Events.MANIFEST_PARSED, () => void this.audio.play().catch(() => {}))
    hls.loadSource(hlsEntryPath(episode.id))
    hls.attachMedia(this.audio)
  }

  private fallBack() {
    const streaming = this.streaming
    if (!streaming) return
    const wasPlaying = !this.audio.paused || streaming.options.autoplay
    const at = this.lastTime
    this.reset()
    streaming.options.onFallback?.(at)
    this.playMp3(streaming.episode, { ...streaming.options, autoplay: wasPlaying, startAt: at })
  }

  private playMp3(episode: StreamEpisode, options: LoadOptions) {
    const audio = this.audio
    audio.src = episode.audioUrl
    // Without a caller to place it (see onFallback), start where asked.
    if (options.startAt && !options.onFallback) {
      const startAt = options.startAt
      audio.addEventListener('loadedmetadata', () => (audio.currentTime = startAt), { once: true })
    }
    if (options.autoplay) void audio.play().catch(() => {})
  }
}
