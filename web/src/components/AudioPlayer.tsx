import { useState } from 'react'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { getNarrationTime, primeNarration, useNarrationPosition } from '../hooks/narration'
import { chapterSeconds, isNarrated, preparedUrl, usePreparedManifest } from '../hooks/preparedAudio'
import { useNavigate } from 'react-router-dom'
import { CATALOG } from '../data/catalog'
import { readPath } from '../data/book'
import { fetchChapters, usePlayableManifest } from '../hooks/offlineBooks'
import { SleepButton, SpeedButton, formatTime } from './PlayerMenus'
import { ListeningOptions } from './ListeningSettings'
import { t } from '../locales'

export function AudioPlayer() {
  const {
    book, playing, loading, error, chapterIdx, rate, history,
    play, pause, nextChapter, prevChapter, skip, seek, setRate,
    sleepTimer, startSleepTimer, extendSleepTimer, cancelSleepTimer,
    setChapter, loadAndPlay,
  } = useAudioPlayer()
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<'chapters' | 'history' | 'settings'>('chapters')
  const navigate = useNavigate()
  const manifest = usePreparedManifest()
  // Offline, Recent lists only books saved on this device (books#24)
  const playable = usePlayableManifest()
  const position = useNarrationPosition()
  // Seek bar value while it is being dragged; seeking on every step would refetch the audio
  const [scrub, setScrub] = useState<number | null>(null)

  // Only narrated books can be listened to (books#19)
  if (!book || !manifest || !isNarrated(manifest, book.slug)) return null
  const narratedHistory = history.filter(h => playable && isNarrated(playable, h.slug))

  const chapter = book.chapters[chapterIdx]
  const totalChapters = book.chapters.length

  // The chapter can be seeked while stopped, and once the element plays it
  const seconds = chapterSeconds(manifest, book.slug, chapterIdx)
  const url = seconds ? preparedUrl(book.slug, chapterIdx) : null
  const onElement = position.url === url
  const seekable = url !== null && (!playing || loading || (onElement && position.active))
  const duration = (onElement && position.duration) || seconds || 0
  const time = scrub ?? (url ? (onElement ? position.time : getNarrationTime(url)) : 0)

  function commitScrub() {
    if (scrub === null) return
    seek(scrub)
    setScrub(null)
  }

  async function switchToBook(slug: string) {
    const catalogBook = CATALOG.find(b => b.id === slug)
    if (!catalogBook) return
    // The book's text loads before it plays: unlock the audio while this is still the tap (iOS)
    primeNarration()

    try {
      const chapters = await fetchChapters(catalogBook.contentPath)
      loadAndPlay({ slug, title: catalogBook.title, author: catalogBook.author, chapters })
      navigate(readPath(slug))
    } catch { /* ignore */ }
  }

  return (
    // No backdrop-filter here: it would make the bar the containing block of the menus'
    // fixed click-catcher, which then covers only the bar and taps outside don't close them
    <div
      ref={trackHeight}
      role="region"
      aria-label={t('player.region')}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      {/* Expanded panel */}
      {expanded && (
        <div id="player-panel" className="border-b border-border px-4 py-3 max-w-4xl mx-auto max-h-64 overflow-y-auto">
          {/* Tabs */}
          <div className="flex gap-4 mb-3 border-b border-border">
            {(['chapters', 'history', 'settings'] as const).map(name => (
              <button
                key={name}
                onClick={() => setTab(name)}
                aria-pressed={tab === name}
                className={`py-2 text-xs font-semibold uppercase tracking-wider transition ${
                  tab === name ? 'text-accent' : 'text-text-dim hover:text-text-muted'
                }`}
              >
                {name === 'chapters' ? t('player.chaptersTab', { count: totalChapters }) : name === 'history' ? t('player.recentTab', { count: narratedHistory.length }) : t('listening.title')}
              </button>
            ))}
          </div>

          {/* Chapters tab */}
          {tab === 'chapters' && (
            <div className="flex flex-wrap gap-1">
              {book.chapters.map((ch, i) => (
                <button
                  key={ch.id}
                  onClick={() => setChapter(i)}
                  // A partly narrated book: only its narrated chapters can be played (books#31)
                  disabled={chapterSeconds(manifest, book.slug, i) === null}
                  aria-current={i === chapterIdx ? 'true' : undefined}
                  className={`min-w-[40px] h-[40px] px-2 text-sm rounded transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    i === chapterIdx
                      ? 'bg-accent text-btn-text font-semibold'
                      : 'bg-surface-hover text-text-muted hover:text-text'
                  }`}
                  title={ch.title}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}

          {/* Listening settings (books#37) */}
          {tab === 'settings' && <div className="pb-1"><ListeningOptions /></div>}

          {/* Recently listened */}
          {tab === 'history' && (
            <div className="space-y-1">
              {narratedHistory.length === 0 ? (
                <p className="text-xs text-text-dim py-2">{t('player.noHistory')}</p>
              ) : (
                narratedHistory.map(h => (
                  <button
                    key={h.slug}
                    onClick={() => switchToBook(h.slug)}
                    aria-current={book.slug === h.slug ? 'true' : undefined}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center justify-between gap-2 ${
                      book.slug === h.slug ? 'bg-accent-soft text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate text-sm">{h.title}</div>
                      <div className="text-xs text-text-muted">{h.author} · {t('chapter.number', { chapter: h.chapterIdx + 1 })}</div>
                    </div>
                    {book.slug === h.slug && playing && (
                      <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" role="img" aria-label={t('player.playing')} />
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Playback stopped by itself: connection lost, or not saved for offline */}
      <div role="status" className="max-w-4xl mx-auto px-3 md:px-4 text-xs text-warning empty:hidden pt-2">{error}</div>

      {/* Chapter position */}
      {seekable && (
        <div className="px-3 md:px-4 pt-2 max-w-4xl mx-auto flex items-center gap-2 text-[11px] tabular-nums text-text-dim">
          <span className="w-12 text-right" aria-hidden="true">{formatTime(time)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(duration))}
            step={1}
            value={Math.min(time, duration)}
            onChange={e => setScrub(Number(e.target.value))}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
            aria-label={t('player.position')}
            aria-valuetext={t('player.positionValue', { time: formatTime(time), duration: formatTime(duration) })}
            className="flex-1 h-6 accent-accent cursor-pointer"
          />
          <span className="w-12" aria-hidden="true">-{formatTime(Math.max(0, duration - time))}</span>
        </div>
      )}

      {/* Main bar; on phones the book takes a line of its own above the controls. Touch targets
          are 40 px, not rem, so the controls still fit a phone at the largest interface size */}
      <div className="px-3 md:px-4 py-1 sm:py-2 max-w-4xl mx-auto flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 md:gap-x-3">
        {/* Book info */}
        <button
          onClick={() => navigate(readPath(book.slug))}
          className="basis-full sm:basis-auto sm:flex-1 min-w-0 text-left flex items-baseline gap-2 sm:block"
        >
          <div className="text-sm font-semibold truncate min-w-0">{book.title}</div>
          <div className="text-xs text-text-muted truncate shrink-0 sm:shrink">
            <span className="hidden sm:inline">{chapter?.title} · </span>{t('chapter.short', { chapter: chapterIdx + 1, chapters: totalChapters })}
          </div>
        </button>

        {/* Controls */}
        <div className="flex items-center gap-0">
          <button onClick={prevChapter} disabled={chapterIdx === 0}
            className="hidden sm:flex w-[40px] h-[40px] items-center justify-center text-text-muted hover:text-text disabled:opacity-30 transition" title={t('player.previousChapterKeys')} aria-label={t('player.previousChapter')} aria-keyshortcuts="Shift+ArrowLeft">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button onClick={() => skip(-15)} disabled={!seekable}
            className="w-[40px] h-[40px] flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30 transition" title={t('player.backKeys')} aria-label={t('player.back')} aria-keyshortcuts="ArrowLeft">
            <SkipIcon seconds={15} back />
          </button>
          <button onClick={playing ? pause : play}
            className="p-2 w-[44px] h-[44px] shrink-0 rounded-full bg-accent text-btn-text hover:bg-accent-hover transition flex items-center justify-center"
            title={t(playing ? 'player.pauseKeys' : 'player.resumeKeys')} aria-label={t(playing ? 'player.pause' : 'player.resume')} aria-keyshortcuts="Space K">
            {loading ? (
              <div className="w-5 h-5 border-2 border-btn-text border-t-transparent rounded-full animate-spin" />
            ) : playing ? (
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>
            ) : (
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button onClick={() => skip(30)} disabled={!seekable}
            className="w-[40px] h-[40px] flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30 transition" title={t('player.forwardKeys')} aria-label={t('player.forward')} aria-keyshortcuts="ArrowRight">
            <SkipIcon seconds={30} />
          </button>
          <button onClick={nextChapter} disabled={chapterIdx >= totalChapters - 1}
            className="hidden sm:flex w-[40px] h-[40px] items-center justify-center text-text-muted hover:text-text disabled:opacity-30 transition" title={t('player.nextChapterKeys')} aria-label={t('player.nextChapter')} aria-keyshortcuts="Shift+ArrowRight">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z"/></svg>
          </button>
        </div>

        <SpeedButton rate={rate} setRate={setRate} />
        <SleepButton timer={sleepTimer} start={startSleepTimer} extend={extendSleepTimer} cancel={cancelSleepTimer} />

        {/* Expand toggle */}
        <button onClick={() => setExpanded(!expanded)}
          className="w-[40px] h-[40px] flex items-center justify-center text-text-muted hover:text-text transition"
          aria-expanded={expanded} aria-controls="player-panel"
          aria-label={t(expanded ? 'chapters.hide' : 'chapters.show')}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            {expanded
              ? <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
              : <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
            }
          </svg>
        </button>
      </div>
    </div>
  )
}

/** Publish the bar's height as --player-h: pages keep their end, and read-along its line, above it. */
function trackHeight(el: HTMLDivElement) {
  const root = document.documentElement
  const observer = new ResizeObserver(() => root.style.setProperty('--player-h', `${el.offsetHeight}px`))
  observer.observe(el)
  return () => {
    observer.disconnect()
    root.style.removeProperty('--player-h')
  }
}

function SkipIcon({ seconds, back = false }: { seconds: number; back?: boolean }) {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <g transform={back ? undefined : 'translate(24 0) scale(-1 1)'}>
        <path d="M4 12a8 8 0 1 0 2.5-5.8" />
        <path d="M4 3v4h4" />
      </g>
      <text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none">{seconds}</text>
    </svg>
  )
}
