import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useAudioPlayer, type AudioBook, type AudioChapter } from '../hooks/useAudioPlayer'
import { NavBar } from '../components/NavBar'
import { PlayButton } from '../components/PlayButton'
import { SaveOfflineButton, SaveOfflineError } from '../components/SaveOfflineButton'
import { fetchChapters, playableManifest, useOnline } from '../hooks/offlineBooks'
import { ChapterText, textOffset, topInset, type TextMark } from '../components/ChapterText'
import { BookSearch, SEARCH_INPUT_ID } from '../components/BookSearch'
import { KEEPS_KEYS } from '../components/KeyboardShortcuts'
import type { SearchHit } from '../hooks/bookSearch'
import { AnnotationEditor, AnnotationList, BookmarkIcon, HighlightToolbar } from '../components/Annotations'
import {
  HIGHLIGHT_COLORS, addAnnotation, annotationsMarkdown, downloadMarkdown, reanchorAnnotations, useAllAnnotations,
  type Annotation, type HighlightColor,
} from '../hooks/annotations'
import { sentenceRanges } from '../hooks/readAlong'
import { getNarrationTime } from '../hooks/narration'
import { loadHistory } from '../hooks/audioStorage'
import { useReaderFontSize } from '../hooks/usePreferences'
import { readLocal, writeLocal } from '../hooks/localStorage'
import { TextSizeControls } from '../components/TextSizeControls'
import { saveProgress, getProgress, setFinished, useFinished } from '../hooks/useReadingProgress'
import { TimeLeft } from '../components/TimeLeft'
import { getTheme, setTheme, type Theme } from '../hooks/useTheme'
import { CATALOG } from '../data/catalog'
import { BookNotFound } from '../components/BookNotFound'
import { chapterSeconds, isNarrated, preparedUrl, usePreparedManifest } from '../hooks/preparedAudio'
import { LOCALE, t } from '../locales'

/** Chapter offset of the text at screen point (x, y), or null when it isn't in `container`. */
function offsetAtPoint(container: HTMLElement, x: number, y: number): number | null {
  // caretPositionFromPoint is the standard (Firefox has only this one); WebKit has caretRangeFromPoint
  const pos = document.caretPositionFromPoint?.(x, y)
  const range = pos ? null : document.caretRangeFromPoint?.(x, y)
  const node = pos?.offsetNode ?? range?.startContainer
  return node && container.contains(node) ? textOffset(container, node, pos?.offset ?? range?.startOffset ?? 0) : null
}

/** Chapter offset of the first text on screen, for a bookmark of the reading position. */
function firstVisibleOffset(container: HTMLElement): number {
  const rect = container.getBoundingClientRect()
  const inset = topInset()
  if (rect.top >= inset) return 0
  return offsetAtPoint(container, rect.left + 1, Math.min(inset + 16, rect.bottom - 1)) ?? 0
}

// Keep the source's own numbering: a preface must not shift Chapter 1 to 2. The texts are in the
// edition's language, so its word for "Chapter" is the locale's.
const CHAPTER_NUMBER = new RegExp(`^${t('reader.chapterWord')} (\\d+)(?=:|$)`)
const chapterLabel = (title: string) => title.replace(CHAPTER_NUMBER, '$1')
const CHAPTERS_VISIBLE_KEY = 'bp-chapters-visible'

export function ReaderPage() {
  const { slug } = useParams<{ slug: string }>()
  const catalogBook = CATALOG.find(b => b.id === slug)
  const [chapters, setChapters] = useState<AudioChapter[]>([])
  const [activeChapter, setActiveChapter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notSavedOffline, setNotSavedOffline] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [desktopChaptersOpen, setDesktopChaptersOpen] = useState(() => readLocal(CHAPTERS_VISIBLE_KEY) !== 'false')
  const fontSize = useReaderFontSize()
  const [textPanelOpen, setTextPanelOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const textButtonRef = useRef<HTMLButtonElement>(null)
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchHit, setSearchHit] = useState<SearchHit | null>(null)
  // Chapter offset to scroll to once the chapter shows (search, bookmarks)
  const [focus, setFocus] = useState<{ offset: number } | null>(null)
  // How far down the chapter on screen the reader is, 0–1 (for the time left)
  const [chapterScroll, setChapterScroll] = useState(0)
  const finished = useFinished()
  const [notesOpen, setNotesOpen] = useState(false)
  // Text selected in the chapter, offered for highlighting
  const [selection, setSelection] = useState<{ start: number; end: number; rect: DOMRect } | null>(null)
  const [editing, setEditing] = useState<Annotation | null>(null)
  // Only the excerpt could be loaded (offline and not saved, or the fetch failed): its offsets
  // aren't the book's, so it neither saves the reading position nor shows or makes annotations
  const excerpt = activeChapter === 'excerpt'
  const allAnnotations = useAllAnnotations()
  const annotations = useMemo(() => (slug && !excerpt && allAnnotations[slug]) || [], [allAnnotations, slug, excerpt])

  const player = useAudioPlayer()
  const articleRef = useRef<HTMLElement>(null)
  // Saved scroll fraction to restore once the chapter has rendered
  const pendingScrollRef = useRef(0)

  // Position the new chapter after its text has reached the DOM, before painting or
  // saving progress. A pre-render smooth scroll can be cancelled by the chapter's
  // changed height and browser scroll anchoring, leaving the next chapter at its end.
  useLayoutEffect(() => {
    const article = articleRef.current
    if (loading || !activeChapter || !article) return
    const saved = pendingScrollRef.current
    pendingScrollRef.current = 0
    const top = saved > 0 ? article.getBoundingClientRect().top + window.scrollY + saved * article.offsetHeight : 0
    window.scrollTo({ top, left: 0, behavior: 'instant' })
  }, [slug, activeChapter, chapters, loading])

  const selectChapter = (id: string) => {
    setFocus(null)
    if (id === activeChapter) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    else setActiveChapter(id)
  }

  const toggleDesktopChapters = () => {
    const next = !desktopChaptersOpen
    setDesktopChaptersOpen(next)
    writeLocal(CHAPTERS_VISIBLE_KEY, String(next))
  }

  useEffect(() => {
    if (!slug) return
    loadBook(slug)
  }, [slug])

  // Highlights follow their text when the book's text changed (an update, or a newer copy online)
  useEffect(() => {
    if (slug && chapters.length > 0 && chapters[0].id !== 'excerpt') reanchorAnnotations(slug, chapters.map(c => c.content))
  }, [slug, chapters])

  // Where each chapter starts in the whole text, and the total, for the share of the book read
  const chapterStarts = useMemo(() => {
    const starts = [0]
    for (const c of chapters) starts.push(starts[starts.length - 1] + c.content.length)
    return starts
  }, [chapters])

  // Save reading progress: chapter, plus how far down it the reader has scrolled
  useEffect(() => {
    if (!slug || !activeChapter || excerpt || chapters.length === 0) return
    const idx = chapters.findIndex(c => c.id === activeChapter)
    if (idx < 0) return
    const scrollFraction = () => {
      const el = articleRef.current
      if (!el) return 0
      const top = el.getBoundingClientRect().top + window.scrollY
      return Math.min(1, Math.max(0, (window.scrollY - top) / el.offsetHeight))
    }
    const save = () => {
      const scroll = scrollFraction()
      const total = chapterStarts[chapterStarts.length - 1]
      const fraction = total > 0 ? (chapterStarts[idx] + scroll * chapters[idx].content.length) / total : 0
      saveProgress(slug, idx, chapters.length, scroll, fraction)
      setChapterScroll(scroll)
    }
    save()
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(save, 300)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [slug, activeChapter, excerpt, chapters, chapterStarts, loading])

  // The player's book and chapter the reader last followed (or opened with), so it follows changes only
  const followedRef = useRef<string | null>(null)
  const playerKey = `${player.book?.slug}:${player.chapterIdx}`

  // Follow the player when its chapter changes (next/prev/auto-advance). Not on
  // activeChapter changes, so the reader can browse other chapters while it plays,
  // nor when the book opens: loadFromCatalog picks that chapter.
  useEffect(() => {
    if (!slug || chapters.length === 0) return
    if (player.book?.slug !== slug || followedRef.current === playerKey) return
    followedRef.current = playerKey
    const target = chapters[player.chapterIdx]
    if (!target) return
    setActiveChapter(target.id)
  }, [player.book?.slug, player.chapterIdx, playerKey, slug, chapters])

  // Escape closes the text size panel and returns focus to its button (books#15)
  useEffect(() => {
    if (!textPanelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setTextPanelOpen(false)
      textButtonRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [textPanelOpen])

  async function loadBook(bookSlug: string) {
    await loadFromCatalog(bookSlug)
    setLoading(false)
  }

  async function loadFromCatalog(bookSlug: string) {
    const catalogBook = CATALOG.find(b => b.id === bookSlug)
    if (!catalogBook) return
    try {
      // A book saved for offline opens from this device (books#7)
      const chaptersList = await fetchChapters(catalogBook.contentPath)
      setChapters(chaptersList)
      const saved = getProgress(bookSlug)
      // The chapter the player is on now isn't one to follow to
      followedRef.current = playerKey
      // A bookmark or highlight opened from My books: /read/<slug>?ch=<idx>&at=<offset>
      const params = new URLSearchParams(window.location.search)
      const linkedIdx = params.has('ch') ? Number(params.get('ch')) : NaN
      if (linkedIdx >= 0 && linkedIdx < chaptersList.length) {
        setActiveChapter(chaptersList[linkedIdx].id)
        setFocus({ offset: Number(params.get('at')) || 0 })
        return
      }
      // The chapter being read aloud while this book plays; else the later of where it was read and listened to
      const heard = loadHistory().find(h => h.slug === bookSlug)
      const lastIdx = player.book?.slug === bookSlug && player.playing ? player.chapterIdx
        : heard && heard.timestamp > (saved?.lastRead ?? 0) ? heard.chapterIdx
        : saved?.chapterIdx ?? 0
      const startIdx = lastIdx < chaptersList.length ? lastIdx : 0
      pendingScrollRef.current = saved?.chapterIdx === startIdx ? saved.scroll ?? 0 : 0
      if (chaptersList.length > 0) setActiveChapter(chaptersList[startIdx].id)
    } catch {
      setNotSavedOffline(!navigator.onLine)
      setChapters([{ id: 'excerpt', title: t('reader.excerpt'), content: catalogBook.excerpt }])
      setActiveChapter('excerpt')
    }
  }

  const isThisBookPlaying = player.book?.slug === slug
  const playingChapterIdx = isThisBookPlaying ? player.chapterIdx : -1

  const currentChapter = chapters.find(c => c.id === activeChapter)
  const visibleChapterIdx = chapters.findIndex(c => c.id === activeChapter)
  const manifest = usePreparedManifest()
  const online = useOnline()
  // Back online on the excerpt: load the whole book, which can then be listened to (books#35)
  useEffect(() => {
    if (!online || !excerpt || !slug) return
    setNotSavedOffline(false)
    loadFromCatalog(slug)
  }, [online])
  // Only narrated books can be listened to; false while the manifest loads (books#19).
  // Offline, only if saved on this device (books#24).
  const narrated = Boolean(slug && manifest && isNarrated(playableManifest(manifest, online), slug))
  const listenOffline = Boolean(slug && manifest && !online && !narrated && isNarrated(manifest, slug))
  // A partly narrated book plays only its narrated chapters (books#31). The excerpt fallback is
  // reading-only: the narration is the whole book's, not the excerpt's (books#35)
  const chapterNarrated = Boolean(narrated && !excerpt && chapterSeconds(manifest!, slug!, visibleChapterIdx) !== null)
  const audioBook = useMemo<AudioBook | null>(
    () => (slug && catalogBook && !excerpt ? { slug, title: catalogBook.title, author: catalogBook.author, chapters } : null),
    [slug, catalogBook, excerpt, chapters],
  )

  const handleTextClick = useCallback((e: React.MouseEvent) => {
    if (!slug || !currentChapter) return
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return
    // A click on a highlight opens it
    const mark = (e.target as Element).closest?.('[data-mark^="hl-"]')
    const highlight = mark && annotations.find(a => a.id === mark.getAttribute('data-mark'))
    if (highlight) {
      setEditing(highlight)
      return
    }
    if (!chapterNarrated) return

    const offset = offsetAtPoint(e.currentTarget as HTMLElement, e.clientX, e.clientY)
    // Listen from the clicked word (seeks there when this chapter is playing)
    if (audioBook && offset !== null) player.loadAndPlay(audioBook, visibleChapterIdx, offset)
  }, [slug, currentChapter, chapterNarrated, player, audioBook, visibleChapterIdx, annotations])

  /** Show chapter `chapterIdx` scrolled to char `offset`. */
  const jumpTo = useCallback((chapterIdx: number, offset: number) => {
    const target = chapters[chapterIdx]
    if (!target) return
    setActiveChapter(target.id)
    setSidebarOpen(false)
    setFocus({ offset })
  }, [chapters])

  const onSearchJump = useCallback((hit: SearchHit) => {
    setSearchHit(hit)
    jumpTo(hit.chapterIdx, hit.start)
  }, [jumpTo])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchHit(null)
  }, [])

  // "/" opens the search, as on many sites
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // KeyboardShortcuts focuses the field while it is open; this opens it
      if (e.key !== '/' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.target as HTMLElement | null)?.closest?.(KEEPS_KEYS)) return
      e.preventDefault()
      setSearchOpen(true)
      document.getElementById(SEARCH_INPUT_ID)?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const marks = useMemo<TextMark[]>(() => {
    const list: TextMark[] = annotations
      .filter(a => a.kind === 'highlight' && a.chapterIdx === visibleChapterIdx && !a.stale)
      .map(a => ({
        start: a.start,
        end: a.end,
        id: a.id,
        className: `${HIGHLIGHT_COLORS[a.color ?? 'yellow'].className} cursor-pointer ${a.note ? 'underline decoration-dotted underline-offset-4' : ''}`,
      }))
    if (searchHit && searchHit.chapterIdx === visibleChapterIdx) {
      list.push({ start: searchHit.start, end: searchHit.end, id: 'search', className: 'bg-warning/40 outline-2 outline-warning rounded-sm' })
    }
    return list
  }, [annotations, searchHit, visibleChapterIdx])

  // Selecting text in the chapter offers to highlight it
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const sel = window.getSelection()
        const container = articleRef.current?.querySelector<HTMLElement>('[data-chapter-text]')
        if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !container) { setSelection(null); return }
        const range = sel.getRangeAt(0)
        if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) { setSelection(null); return }
        const start = textOffset(container, range.startContainer, range.startOffset)
        const end = textOffset(container, range.endContainer, range.endOffset)
        setSelection(end > start ? { start, end, rect: range.getBoundingClientRect() } : null)
      }, 150)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', onChange)
    }
  }, [])

  // The toolbar stays with the selection as the page scrolls or resizes
  const hasSelection = selection !== null
  useEffect(() => {
    if (!hasSelection) return
    const follow = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setSelection(s => s && { ...s, rect })
    }
    window.addEventListener('scroll', follow, { passive: true })
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('scroll', follow)
      window.removeEventListener('resize', follow)
    }
  }, [hasSelection])

  const addHighlight = (color: HighlightColor, withNote: boolean) => {
    if (!slug || !selection || !currentChapter || excerpt) return
    const text = currentChapter.content.slice(selection.start, selection.end).trim()
    const a = addAnnotation(slug, { kind: 'highlight', chapterIdx: visibleChapterIdx, start: selection.start, end: selection.end, color, text })
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    if (withNote) setEditing(a)
  }

  /** Bookmark the listening position while this book plays, else the reading position. */
  const addBookmark = () => {
    if (!slug || chapters.length === 0 || excerpt) return
    const spoken = isThisBookPlaying && player.playing ? player.getReadAlong() : null
    let chapterIdx = visibleChapterIdx
    let offset = 0
    let seconds: number | undefined
    if (spoken) {
      chapterIdx = spoken.chapterIdx
      offset = (spoken.word ?? spoken.sentence)?.[0] ?? 0
      seconds = Math.round(getNarrationTime(preparedUrl(slug, chapterIdx)))
    } else {
      const container = articleRef.current?.querySelector<HTMLElement>('[data-chapter-text]')
      if (container) offset = firstVisibleOffset(container)
    }
    // Named with the sentence at that point
    const text = chapters[chapterIdx].content
    const [a, b] = sentenceRanges(text).find(r => r[1] > offset) ?? [offset, text.length]
    const name = text.slice(a, b).replace(/\s+/g, ' ').trim()
    addAnnotation(slug, { kind: 'bookmark', chapterIdx, start: offset, end: offset, seconds, text: name.length > 160 ? `${name.slice(0, 160)}…` : name })
  }

  const jumpToAnnotation = (a: Annotation) => {
    setNotesOpen(false)
    jumpTo(a.chapterIdx, a.start)
    // Listening: the narration goes there too
    if (audioBook && isThisBookPlaying && player.playing) player.loadAndPlay(audioBook, a.chapterIdx, a.start)
  }

  if (loading) {
    return <div className="min-h-dvh bg-page text-text flex items-center justify-center">{t('app.loading')}</div>
  }

  if (!catalogBook) return <BookNotFound />

  return (
    <div className="min-h-dvh bg-page text-text">
      {/* Stays on screen while reading, so bookmarking, search and the chapter list are always at hand */}
      {/* Below lg the header has two rows: only the actions row stays, so phones keep their reading
          area; the negative top is the first row's height less the row gap (rem, so it follows the interface size).
          Below the status bar/notch in the installed iPhone app. */}
      <div data-reader-top="" className="sticky top-[calc(env(safe-area-inset-top)-3.125rem)] md:top-[calc(env(safe-area-inset-top)-3.25rem)] lg:top-[env(safe-area-inset-top)] z-30 bg-page">
        <NavBar
          title={catalogBook.title}
          subtitle={catalogBook.author ? `${catalogBook.author} · ${LOCALE.genre(catalogBook.genre)}` : LOCALE.genre(catalogBook.genre)}
          actions={<>
            <button
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              aria-expanded={searchOpen}
              aria-label={t('search.label')}
              title={t('search.title')}
              className={`min-h-10 min-w-10 flex items-center justify-center p-1.5 rounded-lg border border-border transition ${searchOpen ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text'}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
            </button>
            <button
              onClick={() => setNotesOpen(o => !o)}
              aria-expanded={notesOpen}
              aria-label={t('notes.title')}
              title={t('notes.title')}
              className={`min-h-10 min-w-10 flex items-center justify-center p-1.5 rounded-lg border border-border transition ${notesOpen ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text'}`}
            >
              <BookmarkIcon />
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-expanded={sidebarOpen}
              aria-controls="chapter-drawer"
              aria-label={t('reader.chaptersButton', { chapter: visibleChapterIdx + 1, chapters: chapters.length })}
              className="md:hidden min-h-10 px-3 py-1.5 rounded-lg text-xs text-text-muted border border-border"
            >
              {t('chapter.short', { chapter: visibleChapterIdx + 1, chapters: chapters.length })}
            </button>
            <button
              onClick={toggleDesktopChapters}
              aria-expanded={desktopChaptersOpen}
              aria-controls="desktop-chapters"
              className="hidden md:inline-flex min-h-10 items-center px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text border border-border"
            >
              {t(desktopChaptersOpen ? 'chapters.hide' : 'chapters.show')}
            </button>
            {/* Phones: Save offline, text size and theme sit behind "More" on a row of their own,
                so search, bookmarks, chapters and Play fit on one line; from sm they're inline */}
            <button
              onClick={() => setMoreOpen(o => !o)}
              aria-expanded={moreOpen}
              aria-controls="reader-more"
              aria-label={t('reader.more')}
              title={t('reader.more')}
              className={`sm:hidden min-h-10 min-w-10 flex items-center justify-center rounded-lg border border-border transition ${moreOpen ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text'}`}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            </button>
            <div id="reader-more" className={`${moreOpen ? 'flex' : 'hidden'} sm:contents order-last basis-full items-center justify-end gap-2`}>
              <SaveOfflineButton slug={slug || ''} />
              {/* Not positioned: the panel hangs from the header's right edge, on screen on phones too */}
              <div>
                <button
                  ref={textButtonRef}
                  onClick={() => setTextPanelOpen(o => !o)}
                  aria-expanded={textPanelOpen}
                  aria-controls="text-size-panel"
                  aria-label={t('reader.textSize')}
                  title={t('reader.textSize')}
                  className={`min-h-10 px-2.5 py-1.5 rounded-lg text-sm border border-border transition ${textPanelOpen ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text'}`}
                >
                  <span aria-hidden="true"><span className="text-xs">A</span><span className="text-base font-semibold">A</span></span>
                </button>
                {textPanelOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setTextPanelOpen(false)} />
                    <div id="text-size-panel" role="group" aria-label={t('reader.textSize')} className="absolute right-4 md:right-6 top-full mt-1 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 shadow-xl text-left">
                      <TextSizeControls preview={false} />
                    </div>
                  </>
                )}
              </div>
              <select
                value={theme}
                onChange={e => { const t = e.target.value as Theme; setThemeState(t); setTheme(t) }}
                aria-label={t('reader.theme')}
                className="min-h-10 bg-surface border border-border rounded-lg px-2 py-1.5 text-base sm:text-xs text-text-muted"
              >
                <option value="dark">{t('theme.dark')}</option>
                <option value="light">{t('theme.light')}</option>
                <option value="sepia">{t('theme.sepia')}</option>
              </select>
            </div>
            {audioBook && <PlayButton book={audioBook} chapterIdx={visibleChapterIdx} />}
          </>}
        />

        {searchOpen && <BookSearch chapters={chapters} onJump={onSearchJump} onClose={closeSearch} />}

        {notesOpen && slug && (
          <section aria-label={t('notes.title')} className="border-b border-border bg-surface">
            <div className="max-w-5xl mx-auto px-4 md:px-6 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={addBookmark}
                  disabled={excerpt}
                  title={excerpt ? t('notes.notInExcerpt') : undefined}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent hover:bg-accent-hover text-btn-text transition disabled:opacity-40"
                >
                  <BookmarkIcon size={14} /> {t('notes.bookmarkHere')}
                </button>
                {annotations.length > 0 && (
                  <button
                    onClick={() => downloadMarkdown(`${slug}-notes.md`, annotationsMarkdown(catalogBook.title, catalogBook.author, chapters.map(c => c.title), annotations))}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border text-text-muted hover:text-text transition"
                  >
                    {t('notes.export')}
                  </button>
                )}
                <button onClick={() => setNotesOpen(false)} aria-label={t('notes.close')} className="ml-auto px-2.5 py-1.5 rounded-lg text-sm border border-border text-text-muted hover:text-text transition">&times;</button>
              </div>
              {annotations.length === 0 ? (
                <p className="mt-3 text-sm text-text-muted">
                  {t('notes.empty')}
                </p>
              ) : (
                <div className="mt-2 max-h-[min(24rem,55dvh)] overflow-y-auto">
                  <AnnotationList slug={slug} list={annotations} chapterTitles={chapters.map(c => c.title)} onJump={jumpToAnnotation} />
                </div>
              )}
            </div>
          </section>
        )}

        {/* Mobile chapter drawer */}
        {sidebarOpen && (
          <nav id="chapter-drawer" aria-label={t('chapters.title')} className="md:hidden border-b border-border bg-surface px-4 py-3 max-h-60 overflow-y-auto">
            <div className="space-y-1">
              {chapters.map((ch, i) => (
                <button
                  key={ch.id}
                  onClick={() => { selectChapter(ch.id); setSidebarOpen(false) }}
                  aria-label={ch.title}
                  aria-current={activeChapter === ch.id ? 'true' : undefined}
                  className={`w-full text-left px-3 py-2.5 rounded text-sm transition flex items-start gap-2 ${
                    activeChapter === ch.id ? 'bg-surface-hover text-text' : 'text-text-muted'
                  }`}
                >
                  {playingChapterIdx === i && player.playing && (
                    <span className="mt-1.5 w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" role="img" aria-label={t('player.playing')} />
                  )}
                  <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{chapterLabel(ch.title)}</span>
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>

      {selection && !excerpt && <HighlightToolbar rect={selection.rect} onHighlight={addHighlight} />}
      {editing && slug && <AnnotationEditor slug={slug} annotation={editing} onClose={() => setEditing(null)} />}

      <SaveOfflineError slug={slug || ''} />
      {notSavedOffline && (
        <div className="border-b border-border bg-warning/10 px-4 py-3 text-center text-sm text-warning">
          {t('reader.offlineExcerpt')}
        </div>
      )}
      {!notSavedOffline && listenOffline && (
        <div role="status" className="border-b border-border bg-warning/10 px-4 py-3 text-center text-sm text-warning">
          {t('reader.offlineListen')}
        </div>
      )}

      <div className={`max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 ${desktopChaptersOpen ? 'md:grid md:grid-cols-[220px_minmax(0,1fr)] md:gap-8' : ''}`}>
        {/* Desktop sidebar */}
        <aside id="desktop-chapters" aria-labelledby="chapters-heading" className={desktopChaptersOpen ? 'hidden md:block' : 'hidden'}>
          <h2 id="chapters-heading" className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-3">{t('chapters.title')}</h2>
          <div className="space-y-1 sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto">
            {chapters.map((ch, i) => (
              <button
                key={ch.id}
                onClick={() => selectChapter(ch.id)}
                aria-label={ch.title}
                aria-current={activeChapter === ch.id ? 'true' : undefined}
                className={`w-full text-left px-3 py-2 rounded text-sm transition flex items-start gap-2 ${
                  activeChapter === ch.id ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text hover:bg-surface'
                }`}
              >
                {playingChapterIdx === i && player.playing && (
                  <span className="mt-1.5 w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" role="img" aria-label={t('player.playing')} />
                )}
                <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{chapterLabel(ch.title)}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Content */}
        <main className="min-w-0 [overflow-wrap:anywhere] bg-page text-text rounded-xl p-4 md:p-8 transition-colors">
          {currentChapter ? (
            <article ref={articleRef}>
              <h2 className="font-display mb-1" style={{ fontSize: `${Math.round(fontSize * 1.35)}px` }}>{currentChapter.title}</h2>
              <TimeLeft slug={slug || ''} chapters={chapters} chapterIdx={visibleChapterIdx} scroll={chapterScroll} />
              <ChapterText
                content={currentChapter.content}
                chapterIdx={visibleChapterIdx}
                active={isThisBookPlaying && player.playing}
                className={`text-text-muted whitespace-pre-wrap ${chapterNarrated ? 'cursor-pointer' : ''}`}
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}
                onClick={handleTextClick}
                title={chapterNarrated ? t('reader.listenFromHere') : undefined}
                marks={marks}
                focus={focus}
              />

              <div className="flex justify-between mt-8 md:mt-12 pt-4 md:pt-6 border-t border-border">
                {visibleChapterIdx > 0 ? (
                  <button
                    onClick={() => selectChapter(chapters[visibleChapterIdx - 1].id)}
                    className="text-text-muted hover:text-text transition text-sm max-w-[45%] truncate"
                  >
                    &larr; {chapters[visibleChapterIdx - 1].title}
                  </button>
                ) : <span />}
                {visibleChapterIdx < chapters.length - 1 ? (
                  <button
                    onClick={() => selectChapter(chapters[visibleChapterIdx + 1].id)}
                    className="text-text-muted hover:text-text transition text-sm max-w-[45%] truncate text-right"
                  >
                    {chapters[visibleChapterIdx + 1].title} &rarr;
                  </button>
                ) : slug && chapters.length > 1 ? (
                  <button
                    onClick={() => setFinished(slug, !finished[slug])}
                    aria-pressed={Boolean(finished[slug])}
                    className={`text-sm font-semibold transition ${finished[slug] ? 'text-success' : 'text-accent hover:text-accent-hover'}`}
                  >
                    {t(finished[slug] ? 'progress.finished' : 'progress.markFinished')}
                  </button>
                ) : <span />}
              </div>
            </article>
          ) : (
            <p className="text-text-muted">{t('reader.selectChapter')}</p>
          )}
        </main>
      </div>
    </div>
  )
}
