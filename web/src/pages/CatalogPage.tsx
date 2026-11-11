import { useState, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CATALOG, GENRES, ALL_TAGS } from '../data/catalog'
import { readPath, type CatalogBook } from '../data/book'
import { EDITION } from '../data/edition'
import { LOCALE, t } from '../locales'
import { BookCover } from '../components/BookCover'
import { NavBar } from '../components/NavBar'
import { booksInProgress, progressPercent, useFinished, type BookProgress } from '../hooks/useReadingProgress'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { ListenButton } from '../components/ListenButton'
import { preparedCount, usePreparedManifest } from '../hooks/preparedAudio'
import { useOfflineBooks, useOnline, usePlayableManifest } from '../hooks/offlineBooks'

export function CatalogPage() {
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState<string>('')
  const [tag, setTag] = useState<string>('')
  const [sort, setSort] = useState<'title' | 'author' | 'year'>('title')
  // Audiobooks only (books#34): in the URL, so it survives going back from a book and can be linked
  const [params, setParams] = useSearchParams()
  const audioOnly = params.get('audio') === '1'
  const setAudioOnly = (on: boolean) => setParams(p => {
    if (on) p.set('audio', '1')
    else p.delete('audio')
    return p
  }, { replace: true })
  // Offline, only saved books can be listened to (books#24)
  const manifest = usePlayableManifest()
  const { saved } = useOfflineBooks()
  const online = useOnline()
  // Offline, only books saved on this device can be opened (books#7)
  const dim = (id: string) => (!online && !saved[id] ? 'opacity-40' : '')

  // Books with narration can be listened to; none show as such while the manifest loads (books#19)
  const entries = useMemo(
    () => CATALOG.map(book => {
      const narratedChapters = manifest ? preparedCount(manifest, book.id) : 0
      return { book, narrated: narratedChapters > 0, narratedChapters }
    }),
    [manifest],
  )

  const filtered = useMemo(() => {
    let books = [...entries]

    if (search) {
      const q = search.toLowerCase()
      books = books.filter(({ book }) =>
        book.title.toLowerCase().includes(q) ||
        book.author.toLowerCase().includes(q) ||
        LOCALE.genre(book.genre).toLowerCase().includes(q) ||
        book.tags.some(t => t.toLowerCase().includes(q))
      )
    }
    if (genre) books = books.filter(({ book }) => book.genre === genre)
    if (tag) books = books.filter(({ book }) => book.tags.includes(tag))
    if (audioOnly) books = books.filter(e => e.narrated)

    books.sort((a, b) => {
      if (sort === 'year') return a.book.year - b.book.year
      return a.book[sort].localeCompare(b.book[sort])
    })

    return books
  }, [entries, search, genre, tag, audioOnly, sort])

  const player = useAudioPlayer()
  const finished = useFinished()
  // Listened shares need every narrated book's lengths, playable now or not
  const fullManifest = usePreparedManifest()
  const progress = useMemo(
    () => new Map(booksInProgress(player.history, fullManifest, finished).map(p => [p.slug, p])),
    [player.history, fullManifest, finished],
  )

  const filtering = Boolean(search || genre || tag || audioOnly)
  const featured = entries.slice(0, 4)
  const audiobooks = entries.filter(e => e.narrated).slice(0, 4)

  return (
    <div className="min-h-dvh bg-page text-text">
      <NavBar />

      <main>
      {/* The page's h1 comes first for screen readers; the Continue shelf is shown above the hero */}
      <h1 className="sr-only">{t('catalog.heading', { name: EDITION.name })}</h1>
      <ContinueShelf entries={entries} dim={dim} />

      <section className="px-4 md:px-6 py-10 md:py-16 max-w-6xl mx-auto">
        <div>
          <h2 className="text-3xl sm:text-5xl md:text-6xl font-display leading-tight mb-3 md:mb-4">
            {t('catalog.hero')}<br />
            <span className="text-accent italic">{t('catalog.heroAccent')}</span>
          </h2>
          <p className="text-base md:text-xl text-text-muted max-w-2xl mb-6 md:mb-8">
            {t('catalog.intro')}
          </p>

          <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:gap-3 mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('catalog.searchPlaceholder')}
              aria-label={t('catalog.searchLabel')}
              aria-keyshortcuts="/"
              data-shortcut="search"
              className="w-full md:flex-1 md:min-w-64 bg-surface border border-border rounded-lg px-4 py-3 text-text placeholder-text-dim focus:border-accent transition"
            />
            <div className="flex gap-2">
              <select
                value={genre}
                onChange={e => setGenre(e.target.value)}
                aria-label={t('catalog.genre')}
                className="flex-1 md:flex-none bg-surface border border-border rounded-lg px-3 py-3 text-text text-base md:text-sm"
              >
                <option value="">{t('catalog.allGenres')}</option>
                {GENRES.map(g => <option key={g} value={g}>{LOCALE.genre(g)}</option>)}
              </select>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as 'title' | 'author' | 'year')}
                aria-label={t('catalog.sort')}
                className="flex-1 md:flex-none bg-surface border border-border rounded-lg px-3 py-3 text-text text-base md:text-sm"
              >
                <option value="title">{t('catalog.byTitle')}</option>
                <option value="author">{t('catalog.byAuthor')}</option>
                <option value="year">{t('catalog.byYear')}</option>
              </select>
              <button
                onClick={() => setAudioOnly(!audioOnly)}
                aria-pressed={audioOnly}
                className={`shrink-0 rounded-lg px-3 py-3 text-base md:text-sm font-semibold border transition ${
                  audioOnly ? 'bg-accent border-accent text-btn-text' : 'bg-surface border-border text-text hover:border-accent'
                }`}
              >
                {t('catalog.audiobooks')}
              </button>
            </div>
          </div>

          {/* Phones: one row that scrolls sideways, so 40 px chips don't push the books down */}
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible">
            {tag && (
              <button
                onClick={() => setTag('')}
                aria-label={t('catalog.removeFilter', { tag })}
                className="shrink-0 min-h-10 md:min-h-0 text-xs px-3 py-1 rounded-full bg-accent text-btn-text font-semibold"
              >
                {tag} &times;
              </button>
            )}
            {ALL_TAGS.filter(t => t !== tag).slice(0, 12).map(t => (
              <button
                key={t}
                onClick={() => setTag(t)}
                className="shrink-0 min-h-10 md:min-h-0 text-xs px-3 py-1 rounded-full border border-border text-text-muted hover:border-accent hover:text-accent transition"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      {!filtering && audiobooks.length > 0 && (
        <section className="px-4 md:px-6 pb-10 md:pb-12 max-w-6xl mx-auto">
          <div className="flex items-baseline justify-between gap-3 mb-4 md:mb-6">
            <h2 className="text-sm font-semibold text-text-dim uppercase tracking-wider">{t('catalog.audiobooks')}</h2>
            <button onClick={() => setAudioOnly(true)} className="min-h-10 md:min-h-0 text-sm text-accent hover:underline">
              {t('catalog.seeAllAudiobooks')}
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {audiobooks.map(({ book, narratedChapters }) => (
              <ShelfBook key={book.id} book={book} narrated={narratedChapters} className={dim(book.id)} />
            ))}
          </div>
        </section>
      )}

      {!filtering && (
        <section className="px-4 md:px-6 pb-10 md:pb-12 max-w-6xl mx-auto">
          <h2 className="text-sm font-semibold text-text-dim uppercase tracking-wider mb-4 md:mb-6">{t('catalog.featured')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {featured.map(({ book, narratedChapters }) => (
              <ShelfBook key={book.id} book={book} narrated={narratedChapters} className={dim(book.id)} />
            ))}
          </div>
        </section>
      )}

      <section className="px-4 md:px-6 pb-20 max-w-6xl mx-auto">
        <h2 className="text-sm font-semibold text-text-dim uppercase tracking-wider mb-4 md:mb-6">
          {filtering
            ? t(audioOnly && !search && !genre && !tag ? 'catalog.audiobookCount' : 'catalog.resultCount', { count: filtered.length })
            : t('catalog.allBooks')}
        </h2>
        <div className="grid gap-3 md:gap-4">
          {filtered.map(({ book, narratedChapters }) => (
            <BookListItem
              key={book.id} book={book} narrated={narratedChapters} saved={Boolean(saved[book.id])} online={online}
              progress={progress.get(book.id)} finished={Boolean(finished[book.id])}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-text-muted py-12 text-center">
              {t(audioOnly && !manifest ? 'catalog.loadingAudiobooks' : audioOnly && !online ? 'catalog.noAudiobooksOffline' : 'catalog.noMatch')}
            </p>
          )}
        </div>
      </section>
      </main>

      <footer className="pt-4 pb-8 text-center">
        <a href="https://freeappstore.online" target="_blank" rel="noopener" className="inline-block py-3 text-[11px] font-medium text-text-dim hover:text-text transition-colors">
          {t('catalog.footer')}
        </a>
      </footer>
    </div>
  )
}

/** A cover on the Audiobooks or Featured shelf. */
function ShelfBook({ book, narrated, className }: { book: CatalogBook; narrated: number; className: string }) {
  return (
    <Link to={readPath(book.id)} className={`group ${className}`}>
      <BookCover book={book} size="lg" />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs md:text-sm text-text-muted group-hover:text-text transition">{LOCALE.readTime(book.readMinutes)}</p>
        {narrated > 0 && <AudiobookPill narrated={narrated} chapters={book.chapters} />}
      </div>
    </Link>
  )
}

function BookListItem({ book, narrated, saved, online, progress, finished }: {
  book: CatalogBook; narrated: number; saved: boolean; online: boolean; progress?: BookProgress; finished: boolean
}) {
  const pct = progress ? progressPercent(progress) : 0

  return (
    <Link
      to={readPath(book.id)}
      className={`group flex gap-3 md:gap-5 bg-surface border border-border rounded-lg p-3 md:p-4 hover:border-accent transition ${!online && !saved ? 'opacity-40' : ''}`}
    >
      <BookCover book={book} size="sm" />
      <div className="flex-1 min-w-0">
        {/* Wraps (and long words break) when the interface text is large on a phone */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <h3 className="font-display text-base md:text-lg [overflow-wrap:anywhere] group-hover:text-accent transition">{book.title}</h3>
            <p className="text-xs md:text-sm text-text-muted mt-0.5">{book.author} &middot; {LOCALE.year(book.year)} &middot; {LOCALE.genre(book.genre)}</p>
          </div>
          {narrated > 0 && <AudiobookPill narrated={narrated} chapters={book.chapters} />}
        </div>

        <p className="text-xs md:text-sm text-text-dim mt-1.5 md:mt-2 line-clamp-2 hidden sm:block">{book.description}</p>

        <div className="flex gap-1.5 md:gap-2 mt-2 md:mt-3 flex-wrap items-center">
          {book.tags.slice(0, 3).map(t => (
            <span key={t} className="text-[11px] md:text-xs px-1.5 md:px-2 py-0.5 rounded-full border border-border text-text-dim">{t}</span>
          ))}
          <span className="text-[11px] md:text-xs text-text-dim ml-auto flex flex-wrap justify-end items-center gap-x-2">
            {saved && <span className="text-success">{t('offline.saved')}</span>}
            {!saved && !online && <span>{t('catalog.notSaved')}</span>}
            {!finished && pct > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-12 h-1 bg-surface-hover rounded-full overflow-hidden">
                  <span className="block h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-accent">{t('progress.percent', { pct })}</span>
              </span>
            )}
            {finished && <span className="text-success">{t('progress.finished')}</span>}
            {LOCALE.readTime(book.readMinutes)}
          </span>
        </div>
      </div>
    </Link>
  )
}

/** Books in progress, reading or listening, each resuming where it stopped (books#13). */
function ContinueShelf({ entries, dim }: { entries: { book: CatalogBook; narrated: boolean }[]; dim: (id: string) => string }) {
  const player = useAudioPlayer()
  const manifest = usePreparedManifest()
  const finished = useFinished()
  const books = booksInProgress(player.history, manifest, finished)
    .flatMap(p => {
      const entry = entries.find(e => e.book.id === p.slug)
      return entry ? [{ ...entry, progress: p }] : []
    })
    .slice(0, 4)
  if (books.length === 0) return null

  return (
    <section aria-labelledby="continue-heading" className="px-4 md:px-6 pt-6 md:pt-8 max-w-6xl mx-auto">
      <h2 id="continue-heading" className="text-sm font-semibold text-text-dim uppercase tracking-wider mb-4">{t('catalog.continue')}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {books.map(({ book, narrated, progress }) => {
          const pct = progressPercent(progress)
          return (
            <div key={book.id} className={dim(book.id)}>
              <Link to={readPath(book.id)} className="group block" aria-label={t('catalog.continueReading', { title: book.title })}>
                <BookCover book={book} size="lg" />
              </Link>
              <div className="mt-2 h-1 bg-surface-hover rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-xs text-text-dim">{t('progress.percent', { pct })} · {t('chapter.short', { chapter: progress.chapterIdx + 1, chapters: book.chapters })}</p>
                {narrated && (
                  <ListenButton book={book} className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-btn-text hover:bg-accent-hover transition" />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Partly narrated books say how many chapters can be listened to (books#31). */
function AudiobookPill({ narrated, chapters }: { narrated: number; chapters: number }) {
  return (
    <span className="shrink-0 rounded-full bg-success-soft px-2 py-1 text-[11px] font-semibold text-success">
      {narrated < chapters ? t('catalog.audiobookPartial', { narrated, chapters }) : t('catalog.audiobook')}
    </span>
  )
}
