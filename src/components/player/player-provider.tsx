import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { saveMyPlaybackPosition } from '~/functions/podcasts'
import { reportActivity } from '~/lib/activity'
import { readLastEpisode, storeLastEpisode } from '~/lib/last-episode'
import { defaultVolume, readStoredVolume, storeVolume, type Volume } from '~/lib/volume'

export type PlayerEpisode = {
  id: string
  title: string
  audioUrl: string
  imageUrl: string | null
  podcastTitle: string
  // For linking to the episode: its manage page for its owner, else its
  // public page. Missing for an episode remembered in this browser from
  // before they were kept.
  slug?: string
  podcastSlug?: string
  isOwner?: boolean
  // Where the listener left off, as last loaded from the server.
  positionSeconds: number | null
}

type PlayerContextValue = {
  episode: PlayerEpisode | null
  playing: boolean
  currentTime: number
  duration: number
  rate: number
  volume: Volume
  // Plays the episode, or toggles play/pause if it's already loaded. With
  // `startAt`, plays from there instead of where the listener left off.
  play: (episode: PlayerEpisode, options?: { startAt?: number }) => void
  toggle: () => void
  seek: (seconds: number) => void
  skip: (seconds: number) => void
  setRate: (rate: number) => void
  // Sets the level (0 to 1), unmuting unless it's 0.
  setVolume: (level: number) => void
  toggleMute: () => void
  close: () => void
  // Where the listener left off in an episode: what the player has saved this
  // session, else the position loaded with the episode.
  positionOf: (episodeId: string, loaded: number | null) => number
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

// One audio element for the whole app, so playback carries on while you move
// between pages. Signed-out listeners' positions are only kept in this browser.
// `source` is where plays are reported as coming from, for the podcast's stats.
export function PlayerProvider({
  signedIn,
  source = 'web',
  children,
}: {
  signedIn: boolean
  source?: 'web' | 'listen'
  children: ReactNode
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [episode, setEpisode] = useState<PlayerEpisode | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRateState] = useState(1)
  // Read from storage after hydration, as the server can't know it.
  const [volume, setVolumeState] = useState<Volume>(defaultVolume)
  useEffect(() => setVolumeState(readStoredVolume()), [])
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume.level
    audio.muted = volume.muted
  }, [volume])
  const changeVolume = useCallback((next: Volume) => {
    setVolumeState(next)
    storeVolume(next)
  }, [])
  // Positions saved this session, which are newer than any loaded with a page.
  const [positions, setPositions] = useState<Record<string, number>>({})
  const lastSaved = useRef<Record<string, number>>({})

  // Where each episode was left off is kept on the server, so playback resumes
  // there on any device.
  const savePosition = useCallback((id: string, seconds: number) => {
    const position = Math.floor(seconds)
    if (lastSaved.current[id] === position) return
    lastSaved.current[id] = position
    setPositions((current) => ({ ...current, [id]: position }))
    if (!signedIn) return
    saveMyPlaybackPosition({ data: { episodeId: id, seconds: position } }).catch(() => {
      // Resuming is a nicety; try again next time rather than surface an error.
      delete lastSaved.current[id]
    })
  }, [signedIn])

  const positionOf = useCallback(
    (episodeId: string, loaded: number | null) => positions[episodeId] ?? loaded ?? 0,
    [positions],
  )

  // Where to start the episode that's loading, instead of resuming.
  const startAt = useRef<number | null>(null)

  // Queue up the episode from last visit, paused, once hydrated (the server
  // can't see storage). Until then there's nothing to remember.
  const [restored, setRestored] = useState(false)
  // The episode queued up that way, until it's played or replaced.
  const restoredId = useRef<string | null>(null)
  useEffect(() => {
    const last = readLastEpisode()
    const audio = audioRef.current
    if (last && audio) {
      restoredId.current = last.id
      setEpisode(last)
      audio.src = last.audioUrl
    }
    setRestored(true)
  }, [])

  // Remember the loaded episode, with where it was left off.
  useEffect(() => {
    if (!restored) return
    storeLastEpisode(episode && { ...episode, positionSeconds: positions[episode.id] ?? episode.positionSeconds })
  }, [restored, episode, positions])

  const play = useCallback(
    (next: PlayerEpisode, options?: { startAt?: number }) => {
      const audio = audioRef.current
      if (!audio) return
      if (episode?.id === next.id) {
        if (options?.startAt !== undefined) {
          audio.currentTime = options.startAt
          setCurrentTime(audio.currentTime)
          if (audio.paused) void audio.play()
        } else if (audio.paused) void audio.play()
        else audio.pause()
        return
      }
      startAt.current = options?.startAt ?? null
      if (episode) savePosition(episode.id, audio.currentTime)
      setEpisode(next)
      // Where it will start once loaded (see onLoadedMetadata), so the
      // progress shown doesn't drop to 0 and jump back in the meantime.
      setCurrentTime(options?.startAt ?? positionOf(next.id, next.positionSeconds))
      setDuration(0)
      audio.src = next.audioUrl
      audio.playbackRate = rate
      void audio.play()
    },
    [episode, rate, savePosition, positionOf],
  )

  const value = useMemo<PlayerContextValue>(
    () => ({
      episode,
      playing,
      currentTime,
      duration,
      rate,
      volume,
      play,
      positionOf,
      toggle: () => {
        const audio = audioRef.current
        if (!audio || !episode) return
        if (audio.paused) void audio.play()
        else audio.pause()
      },
      seek: (seconds) => {
        const audio = audioRef.current
        if (!audio) return
        audio.currentTime = seconds
        setCurrentTime(audio.currentTime)
      },
      skip: (seconds) => {
        const audio = audioRef.current
        if (!audio) return
        audio.currentTime = Math.min(Math.max(0, audio.currentTime + seconds), audio.duration || 0)
        setCurrentTime(audio.currentTime)
      },
      setRate: (next) => {
        setRateState(next)
        if (audioRef.current) audioRef.current.playbackRate = next
      },
      setVolume: (level) => changeVolume({ level, muted: level === 0 }),
      // Unmuting at zero would still be silent, so it goes back to full.
      toggleMute: () =>
        changeVolume(volume.muted || volume.level === 0 ? { level: volume.level || 1, muted: false } : { ...volume, muted: true }),
      close: () => {
        const audio = audioRef.current
        if (audio && episode) {
          savePosition(episode.id, audio.currentTime)
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
        }
        setEpisode(null)
        setPlaying(false)
      },
    }),
    [episode, playing, currentTime, duration, rate, volume, play, positionOf, savePosition, changeVolume],
  )

  // Report each episode's first play on this page, for the podcast's stats.
  const reported = useRef(new Set<string>())
  useEffect(() => {
    if (!playing || !episode || reported.current.has(episode.id)) return
    reported.current.add(episode.id)
    reportActivity(episode.id, { type: 'play', source })
  }, [playing, episode, source])

  // While something plays, the left and right arrow keys skip back and forward
  // on any page, unless they're wanted where they're pressed: in a field, or
  // by a control that handles them itself (like the waveform, which seeks by 5).
  useEffect(() => {
    if (!playing) return
    const onKeyDown = (event: KeyboardEvent) => {
      const step = { ArrowLeft: -arrowSkipSeconds, ArrowRight: arrowSkipSeconds }[event.key]
      if (step === undefined || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (wantsArrowKeys(event.target)) return
      const audio = audioRef.current
      if (!audio) return
      event.preventDefault()
      audio.currentTime = Math.min(Math.max(0, audio.currentTime + step), audio.duration || 0)
      setCurrentTime(audio.currentTime)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [playing])

  // Save the position every few seconds while playing.
  useEffect(() => {
    if (!playing || !episode) return
    const timer = setInterval(() => {
      if (audioRef.current) savePosition(episode.id, audioRef.current.currentTime)
    }, 5000)
    return () => clearInterval(timer)
  }, [playing, episode, savePosition])

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={(event) => {
          setPlaying(false)
          // Pauses also fire when a new episode loads (before its metadata) and just
          // before it ends; those are handled elsewhere.
          const audio = event.currentTarget
          if (episode && !audio.ended && audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
            savePosition(episode.id, audio.currentTime)
          }
        }}
        onEnded={() => {
          setPlaying(false)
          if (episode) savePosition(episode.id, 0)
        }}
        onPlaying={() => {
          restoredId.current = null
        }}
        // An episode queued up from last visit may have been deleted since, or
        // belong to whoever was signed in before; drop it rather than show it broken.
        onError={() => {
          if (episode && episode.id === restoredId.current) {
            restoredId.current = null
            setEpisode(null)
          }
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        // A seek moves the position at once; timeupdate only follows once the
        // new part of the file has loaded, so without this the progress shown
        // would spring back to the old position until then.
        onSeeking={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget
          setDuration(audio.duration)
          if (startAt.current !== null) {
            audio.currentTime = startAt.current
            startAt.current = null
            return
          }
          // Resume where the listener left off, unless that was the very end.
          const resumeAt = episode ? positionOf(episode.id, episode.positionSeconds) : 0
          if (resumeAt > 0 && resumeAt < audio.duration - 10) audio.currentTime = resumeAt
        }}
      />
    </PlayerContext.Provider>
  )
}

export function usePlayer() {
  const context = useContext(PlayerContext)
  if (!context) throw new Error('usePlayer must be used within a PlayerProvider')
  return context
}

// How far the arrow keys skip while something plays.
export const arrowSkipSeconds = 20

// Whether arrow keys pressed here move something else: a caret in a field, or
// a control such as a slider, tab list or menu.
function wantsArrowKeys(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true
  return Boolean(
    target.closest('[role="slider"], [role="tablist"], [role="tab"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="radiogroup"], [role="radio"], [role="combobox"], [role="spinbutton"]'),
  )
}
