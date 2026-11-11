import { createContext, useContext, useState, useCallback, useRef, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import {
  getNarrationTime, narrationIntroPlaying, playNarration, primeNarration, releaseNarration, seekNarration, setVolumeBoost as setNarrationBoost,
  type Narration,
} from './narration'
import {
  chapterSeconds, getLoadedManifest, getManifestExtras, isNarrated, loadPreparedManifest, preparedUrl, titleSeconds,
  type PreparedManifest,
} from './preparedAudio'
import { getChapterPause, getContinueChapters, getReadTitles } from './usePreferences'
import { t } from '../locales'
import { playableManifest } from './offlineBooks'
import {
  loadRate, saveRate, loadHistory, saveHistory, loadPosition, savePosition, saveSleepChoice,
  type HistoryEntry,
} from './audioStorage'
import {
  loadTimings, positionFromTimings, timeForChar,
  type CharRange, type ReadAlongPosition, type TimingSegment,
} from './readAlong'

export const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.75, 2, 2.5, 3]

/** Sleep after this many minutes of playback, or at the end of the chapter. */
export type SleepChoice = number | 'chapter'

export interface SleepTimer {
  choice: SleepChoice
  /** Playback time left, in ms (minutes timers only) */
  remaining: number
}

// The sleep timer fades the volume out over its last seconds
const SLEEP_FADE_MS = 10_000

export interface AudioChapter {
  id: string
  title: string
  content: string
}

export interface AudioBook {
  slug: string
  title: string
  author: string
  chapters: AudioChapter[]
}

interface AudioPlayerState {
  book: AudioBook | null
  playing: boolean
  /** Playing was asked for and the audio hasn't started yet */
  loading: boolean
  /** Why playback stopped by itself (connection lost, not saved offline); cleared by Play */
  error: string | null
  chapterIdx: number
  rate: number
  history: HistoryEntry[]
  /**
   * Play `book` from `chapterIdx` (default: the chapter listened to last), where
   * that chapter was stopped, or from the word at `charOffset`. A word of the
   * chapter playing just seeks there.
   */
  loadAndPlay: (book: AudioBook, chapterIdx?: number, charOffset?: number) => void
  play: () => void
  pause: () => void
  setChapter: (idx: number) => void
  nextChapter: () => void
  prevChapter: () => void
  /** Jump `seconds` forward (or back, if negative) in the chapter */
  skip: (seconds: number) => void
  /** Move the current chapter to `seconds` */
  seek: (seconds: number) => void
  sleepTimer: SleepTimer | null
  startSleepTimer: (choice: SleepChoice) => void
  /** Add minutes to a running timer */
  extendSleepTimer: (minutes: number) => void
  cancelSleepTimer: () => void
  setRate: (rate: number) => void
  /** Volume boost on or off (books#37); call it in the click */
  setVolumeBoost: (on: boolean) => void
  /** Read-along position, outside React state so it can change many times a second. */
  subscribeReadAlong: (listener: () => void) => () => void
  getReadAlong: () => ReadAlongPosition | null
}

const AudioPlayerContext = createContext<AudioPlayerState | null>(null)

/** First chapter from `start` going `dir` that has narration, or -1. */
function narratedFrom(m: PreparedManifest, b: AudioBook, start: number, dir: 1 | -1): number {
  for (let i = start; i >= 0 && i < b.chapters.length; i += dir) {
    if (chapterSeconds(m, b.slug, i) !== null) return i
  }
  return -1
}

/** Previous/Next can't go anywhere: no narrated chapter that way. Then it leaves playback alone. */
function noChapterThatWay(b: AudioBook, start: number, dir: 1 | -1): boolean {
  const m = getLoadedManifest()
  return !!m && narratedFrom(playableManifest(m), b, start, dir) < 0
}

function sameRange(a: CharRange | null, b: CharRange | null) {
  return a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1])
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<AudioBook | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chapterIdx, setChapterIdx] = useState(0)
  const [rate, setRateState] = useState(loadRate)
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [sleepTimer, setSleepTimer] = useState<SleepTimer | null>(null)
  const sleepTimerRef = useRef(sleepTimer)
  sleepTimerRef.current = sleepTimer
  // Playback volume, lowered by the sleep timer's fade
  const volumeRef = useRef(1)

  const bookRef = useRef(book)
  const chapterIdxRef = useRef(chapterIdx)
  const rateRef = useRef(rate)
  bookRef.current = book
  chapterIdxRef.current = chapterIdx
  rateRef.current = rate
  // Generation counter: bumped whenever playback is halted, so callbacks from
  // the halted chapter are ignored.
  const genRef = useRef(0)
  const narrationRef = useRef<Narration | null>(null)
  const pendingNarrationRef = useRef<AbortController | null>(null)
  // The chapter playing, for read-along and seeking to a word (timings undefined while loading)
  const trackRef = useRef<{ audio: HTMLAudioElement; idx: number; text: string; timings?: TimingSegment[] | null } | null>(null)

  useEffect(() => () => { pendingNarrationRef.current?.abort(); narrationRef.current?.stop() }, [])

  // One tab plays at a time: playing in another tab (or the installed app) pauses this one
  const channelRef = useRef<BroadcastChannel | null>(null)
  const pauseRef = useRef(() => {})
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel('bp-playing')
    channel.onmessage = () => pauseRef.current()
    channelRef.current = channel
    return () => channel.close()
  }, [])

  const readAlongRef = useRef<ReadAlongPosition | null>(null)
  const readAlongListenersRef = useRef(new Set<() => void>())
  const setReadAlong = useCallback((pos: ReadAlongPosition | null) => {
    const prev = readAlongRef.current
    if (prev === pos || (prev && pos && prev.chapterIdx === pos.chapterIdx
      && sameRange(prev.sentence, pos.sentence) && sameRange(prev.word, pos.word))) return
    readAlongRef.current = pos
    for (const listener of readAlongListenersRef.current) listener()
  }, [])
  const subscribeReadAlong = useCallback((listener: () => void) => {
    readAlongListenersRef.current.add(listener)
    return () => { readAlongListenersRef.current.delete(listener) }
  }, [])
  const getReadAlong = useCallback(() => readAlongRef.current, [])

  /** Stop the audio and invalidate its pending callbacks; returns the new generation. */
  const halt = useCallback(() => {
    const gen = ++genRef.current
    pendingNarrationRef.current?.abort()
    pendingNarrationRef.current = null
    narrationRef.current?.stop()
    narrationRef.current = null
    setLoading(false)
    trackRef.current = null
    setReadAlong(null)
    return gen
  }, [setReadAlong])

  /** Follow the audio element of chapter `idx` until playback is halted. */
  const followNarration = useCallback((gen: number, b: AudioBook, idx: number, audio: HTMLAudioElement) => {
    const text = b.chapters[idx].content
    const track: NonNullable<typeof trackRef.current> = { audio, idx, text }
    trackRef.current = track
    loadTimings(b.slug, idx).then(t => { track.timings = t })
    // currentTime has no change event finer than timeupdate (4 Hz): read it each frame.
    // setReadAlong only notifies when the word or sentence changes.
    const tick = () => {
      if (gen !== genRef.current) return
      // Read-along starts with the chapter, after its pause and spoken title (books#37)
      if (narrationIntroPlaying()) {
        requestAnimationFrame(tick)
        return
      }
      // A chapter without timings plays without read-along: a guessed highlight drifts (books#31)
      if (audio.ended || track.timings === null) return
      if (audio.readyState > 0 && !audio.seeking && track.timings) {
        setReadAlong({ chapterIdx: idx, ...positionFromTimings(text, track.timings, audio.currentTime) })
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [setReadAlong])

  // startPlayback and finishChapter call each other
  const finishChapterRef = useRef<(idx: number) => void>(() => {})

  /**
   * Play chapter `idx` of the current book, from where it was stopped or from
   * the word at `charOffset`. Chapters without narration are passed over in
   * the direction of travel; when none is left that way, playback stops.
   * `advance`: the previous chapter just ended (the pause between chapters).
   */
  const startPlayback = useCallback(async (start: number, charOffset?: number, dir: 1 | -1 = 1, advance = false) => {
    const b = bookRef.current
    if (!b || start < 0 || start >= b.chapters.length) return
    const gen = halt()
    const controller = new AbortController()
    pendingNarrationRef.current = controller
    // Synchronously, while this is still the user's click (iOS)
    primeNarration()
    setPlaying(true)
    setLoading(true)
    setError(null)

    // Offline, only chapters saved on this device (books#24)
    const manifest = playableManifest(await loadPreparedManifest())
    if (gen !== genRef.current) return
    const idx = narratedFrom(manifest, b, start, dir)
    if (idx < 0) {
      halt()
      releaseNarration()
      setPlaying(false)
      if (!navigator.onLine) setError(t('player.errorOfflineRest'))
      return
    }
    if (idx !== start) charOffset = undefined
    const seconds = chapterSeconds(manifest, b.slug, idx)!
    setChapterIdx(idx)
    chapterIdxRef.current = idx
    savePosition(b.slug, idx)
    if (charOffset !== undefined) {
      const text = b.chapters[idx].content
      const timings = await loadTimings(b.slug, idx)
      if (gen !== genRef.current) return
      seekNarration(preparedUrl(b.slug, idx), timeForChar(text, timings, charOffset, seconds), seconds)
    }
    const fail = (err: unknown) => {
      if (gen !== genRef.current) return
      console.error('Narration failed:', err)
      // halt() keeps the position: Play resumes there
      halt()
      setPlaying(false)
      setError(navigator.onLine
        ? t('player.errorChapter')
        : t('player.errorConnection'))
    }
    // From the chapter's start: the pause (auto-advance only) and its spoken title first (books#37)
    const before = {
      pause: advance ? getChapterPause() : 0,
      title: charOffset === undefined && getReadTitles() && titleSeconds(getManifestExtras(), b.slug, idx) !== null,
      seconds,
    }
    try {
      const narration = await playNarration(b.slug, idx, rateRef.current, {
        onPlaying: () => {
          if (gen !== genRef.current) return
          setLoading(false)
          channelRef.current?.postMessage('playing')
        },
        onEnded: () => { if (gen === genRef.current) finishChapterRef.current(idx) },
        // Headphones unplugged, a call, another app: the browser paused it
        onPaused: () => { if (gen === genRef.current) { halt(); setPlaying(false) } },
        onError: fail,
      }, controller.signal, before)
      // Halted (pause, another chapter) while loading
      if (gen !== genRef.current) {
        narration.stop()
        return
      }
      narrationRef.current = narration
      narration.setVolume(volumeRef.current)
      followNarration(gen, b, idx, narration.audio)
    } catch (err) {
      fail(err)
    }
  }, [halt, followNarration])

  /**
   * Chapter `idx` finished: play the next one, or stop at the end of the book.
   * The sleep timer's "end of chapter" and "Continue to the next chapter" off stop here.
   */
  const finishChapter = useCallback((idx: number) => {
    const b = bookRef.current
    const sleeping = sleepTimerRef.current?.choice === 'chapter'
    if (sleeping || !getContinueChapters()) {
      // Stop here and resume with the next chapter
      halt()
      setPlaying(false)
      if (sleeping) {
        setSleepTimer(null)
        volumeRef.current = 1
      }
      if (b && idx + 1 < b.chapters.length) {
        setChapterIdx(idx + 1)
        chapterIdxRef.current = idx + 1
        savePosition(b.slug, idx + 1)
      }
      return
    }
    if (b && idx + 1 < b.chapters.length) {
      startPlayback(idx + 1, undefined, 1, true)
    } else {
      halt()
      setPlaying(false)
    }
  }, [startPlayback, halt])
  finishChapterRef.current = finishChapter

  const updateHistory = useCallback((b: AudioBook, idx: number) => {
    setHistory(prev => {
      const filtered = prev.filter(h => h.slug !== b.slug)
      const entry: HistoryEntry = { slug: b.slug, title: b.title, author: b.author, chapterIdx: idx, timestamp: Date.now() }
      const updated = [entry, ...filtered]
      saveHistory(updated)
      return updated
    })
  }, [])

  // Keep history in sync with current playback position
  useEffect(() => {
    if (!book) return
    setHistory(prev => {
      const idx = prev.findIndex(h => h.slug === book.slug)
      if (idx === -1) return prev
      if (prev[idx].chapterIdx === chapterIdx) return prev
      const updated = [...prev]
      updated[idx] = { ...updated[idx], chapterIdx, timestamp: Date.now() }
      saveHistory(updated)
      return updated
    })
  }, [book, chapterIdx])

  const loadAndPlay = useCallback((newBook: AudioBook, startChapter?: number, charOffset?: number) => {
    // Books without narration are reading-only (books#19)
    const manifest = getLoadedManifest()
    if (!manifest || !isNarrated(playableManifest(manifest), newBook.slug)) return
    const track = trackRef.current
    if (charOffset !== undefined && bookRef.current?.slug === newBook.slug && track?.idx === startChapter
      && !narrationIntroPlaying() && track.audio.readyState > 0 && track.timings !== undefined) {
      track.audio.currentTime = timeForChar(track.text, track.timings, charOffset, track.audio.duration)
      return
    }
    // A revised catalogue can have fewer chapters than the saved position.
    const idx = Math.min(Math.max(0, startChapter ?? loadPosition(newBook.slug)), newBook.chapters.length - 1)
    setBook(newBook)
    bookRef.current = newBook
    updateHistory(newBook, idx)
    startPlayback(idx, charOffset)
  }, [startPlayback, updateHistory])

  const play = useCallback(() => {
    if (bookRef.current) startPlayback(chapterIdxRef.current)
  }, [startPlayback])

  const pause = useCallback(() => {
    halt()
    releaseNarration()
    setPlaying(false)
    setError(null)
  }, [halt])
  pauseRef.current = () => { if (playing) pause() }

  const setChapterAndPlay = useCallback((idx: number, dir: 1 | -1 = 1) => {
    const b = bookRef.current
    if (!b || idx < 0 || idx >= b.chapters.length) return
    if (playing) {
      if (!noChapterThatWay(b, idx, dir)) startPlayback(idx, undefined, dir)
      return
    }
    setChapterIdx(idx)
    chapterIdxRef.current = idx
    savePosition(b.slug, idx)
  }, [playing, startPlayback])

  const nextChapter = useCallback(() => {
    setChapterAndPlay(chapterIdxRef.current + 1)
  }, [setChapterAndPlay])

  const prevChapter = useCallback(() => {
    setChapterAndPlay(chapterIdxRef.current - 1, -1)
  }, [setChapterAndPlay])

  /** The current chapter's audio URL and length in seconds, when it is narrated. */
  const currentChapter = useCallback(() => {
    const b = bookRef.current
    const manifest = getLoadedManifest()
    const seconds = b && manifest ? chapterSeconds(manifest, b.slug, chapterIdxRef.current) : null
    return b && seconds ? { url: preparedUrl(b.slug, chapterIdxRef.current), seconds } : null
  }, [])

  const seek = useCallback((seconds: number) => {
    const c = currentChapter()
    if (c) seekNarration(c.url, seconds, c.seconds)
  }, [currentChapter])

  const skip = useCallback((seconds: number) => {
    const c = currentChapter()
    if (c) seekNarration(c.url, getNarrationTime(c.url) + seconds, c.seconds)
  }, [currentChapter])

  const setVolume = useCallback((v: number) => {
    volumeRef.current = v
    narrationRef.current?.setVolume(v)
  }, [])

  const startSleepTimer = useCallback((choice: SleepChoice) => {
    saveSleepChoice(choice)
    setSleepTimer({ choice, remaining: choice === 'chapter' ? 0 : choice * 60_000 })
    setVolume(1)
  }, [setVolume])

  const extendSleepTimer = useCallback((minutes: number) => {
    setSleepTimer(t => t && t.choice !== 'chapter' ? { ...t, remaining: t.remaining + minutes * 60_000 } : t)
    setVolume(1)
  }, [setVolume])

  const cancelSleepTimer = useCallback(() => {
    setSleepTimer(null)
    setVolume(1)
  }, [setVolume])

  // The sleep timer counts playback time only. Ticks measure the wall clock, so
  // throttled timers on a locked screen still end it on time.
  const sleepChoice = sleepTimer?.choice
  useEffect(() => {
    if (sleepChoice === undefined || !playing) return
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const elapsed = now - last
      last = now
      const t = sleepTimerRef.current
      if (!t) return
      if (t.choice === 'chapter') {
        // finishChapter stops at the end; fade over the chapter's last seconds
        const c = currentChapter()
        if (c) {
          const leftMs = (c.seconds - getNarrationTime(c.url)) / rateRef.current * 1000
          setVolume(Math.min(1, Math.max(0, leftMs / SLEEP_FADE_MS)))
        }
        return
      }
      const remaining = t.remaining - elapsed
      if (remaining <= 0) {
        pause()
        setSleepTimer(null)
        setVolume(1)
        return
      }
      setVolume(Math.min(1, remaining / SLEEP_FADE_MS))
      // Ahead of the render: the next tick may come first
      sleepTimerRef.current = { ...t, remaining }
      setSleepTimer(sleepTimerRef.current)
    }, 1000)
    return () => clearInterval(id)
  }, [sleepChoice, playing, pause, currentChapter, setVolume])

  // Media Session API — lock screen controls + background audio metadata
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!book) {
      navigator.mediaSession.metadata = null
      return
    }
    const chapter = book.chapters[chapterIdx]
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapter?.title || book.title,
      artist: book.author,
      album: book.title,
    })
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [book, chapterIdx, playing])

  // Lock-screen buttons do exactly what the on-screen ones do. Track changes
  // from there always start playing.
  const mediaActionsRef = useRef({ play, pause, startPlayback, skip, seek })
  mediaActionsRef.current = { play, pause, startPlayback, skip, seek }
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const track = (delta: number) => {
      const b = bookRef.current
      const idx = chapterIdxRef.current + delta
      const dir = delta < 0 ? -1 : 1
      if (b && idx >= 0 && idx < b.chapters.length && !noChapterThatWay(b, idx, dir)) mediaActionsRef.current.startPlayback(idx, undefined, dir)
    }
    ms.setActionHandler('play', () => mediaActionsRef.current.play())
    ms.setActionHandler('pause', () => mediaActionsRef.current.pause())
    ms.setActionHandler('nexttrack', () => track(1))
    ms.setActionHandler('previoustrack', () => track(-1))
    ms.setActionHandler('seekbackward', d => mediaActionsRef.current.skip(-(d.seekOffset || 15)))
    ms.setActionHandler('seekforward', d => mediaActionsRef.current.skip(d.seekOffset || 30))
    try {
      ms.setActionHandler('seekto', d => { if (d.seekTime != null) mediaActionsRef.current.seek(d.seekTime) })
    } catch { /* not supported by every browser */ }
    return () => {
      ms.setActionHandler('play', null)
      ms.setActionHandler('pause', null)
      ms.setActionHandler('nexttrack', null)
      ms.setActionHandler('previoustrack', null)
      ms.setActionHandler('seekbackward', null)
      ms.setActionHandler('seekforward', null)
      try { ms.setActionHandler('seekto', null) } catch {}
    }
  }, [])

  const setRate = useCallback((r: number) => {
    setRateState(r)
    rateRef.current = r
    saveRate(r)
    narrationRef.current?.setRate(r)
  }, [])

  const setVolumeBoost = useCallback((on: boolean) => {
    // The chapter playing was loaded without CORS: Web Audio hears it only once loaded again
    if (setNarrationBoost(on) && playing) startPlayback(chapterIdxRef.current)
  }, [playing, startPlayback])

  return (
    <AudioPlayerContext.Provider value={{
      book, playing, loading, error, chapterIdx, rate, history,
      loadAndPlay, play, pause,
      setChapter: setChapterAndPlay, nextChapter, prevChapter, skip, seek,
      sleepTimer, startSleepTimer, extendSleepTimer, cancelSleepTimer,
      setRate, setVolumeBoost, subscribeReadAlong, getReadAlong,
    }}>
      {children}
    </AudioPlayerContext.Provider>
  )
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext)
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider')
  return ctx
}

/** The read-along position; re-renders only the calling component when it moves. */
export function useReadAlong(): ReadAlongPosition | null {
  const { subscribeReadAlong, getReadAlong } = useAudioPlayer()
  return useSyncExternalStore(subscribeReadAlong, getReadAlong)
}
