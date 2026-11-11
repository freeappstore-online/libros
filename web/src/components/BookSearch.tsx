import { useEffect, useMemo, useState } from 'react'
import { searchBook, snippet, type SearchHit } from '../hooks/bookSearch'
import { t } from '../locales'

/** id of the search field, for keyboard shortcuts that focus it */
export const SEARCH_INPUT_ID = 'reader-search'

/** Results listed at once; more are reached with next/previous */
const LIST_LIMIT = 200

interface Props {
  chapters: { title: string; content: string }[]
  onJump: (hit: SearchHit) => void
  onClose: () => void
}

/** Search inside the open book (books#12): every match with its chapter and a snippet. */
export function BookSearch({ chapters, onJump, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [current, setCurrent] = useState(-1)
  const [showList, setShowList] = useState(true)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(id)
  }, [query])

  const hits = useMemo(() => searchBook(chapters, debounced), [chapters, debounced])
  const chapterCount = useMemo(() => new Set(hits.map(h => h.chapterIdx)).size, [hits])
  useEffect(() => { setCurrent(-1); setShowList(true) }, [hits])

  const go = (i: number) => {
    if (hits.length === 0) return
    const idx = (i + hits.length) % hits.length
    setCurrent(idx)
    setShowList(false)
    onJump(hits[idx])
  }

  const q = debounced.trim()
  const status = q.length < 2
    ? ''
    : hits.length === 0
      ? t('search.none')
      : current >= 0
        ? t('search.position', { current: current + 1, total: hits.length })
        : t('search.summary', { matches: t('search.matches', { count: hits.length }), chapters: t('search.chapters', { count: chapterCount }) })

  const btn = 'px-2.5 py-1.5 rounded-lg text-sm border border-border text-text-muted hover:text-text disabled:opacity-40 transition'

  return (
    <div role="search" className="border-b border-border bg-surface">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-3">
        <div className="flex items-center gap-2">
          <input
            id={SEARCH_INPUT_ID}
            data-shortcut="search"
            aria-keyshortcuts="/"
            type="search"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? current - 1 : current + 1) }
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
            placeholder={t('search.label')}
            aria-label={t('search.label')}
            className="min-w-0 flex-1 bg-page border border-border rounded-lg px-3 py-1.5 text-text placeholder-text-dim focus:outline-none focus:border-accent transition"
          />
          <button onClick={() => go(current - 1)} disabled={hits.length === 0} aria-label={t('search.previous')} title={t('search.previous')} className={btn}>&uarr;</button>
          <button onClick={() => go(current + 1)} disabled={hits.length === 0} aria-label={t('search.next')} title={t('search.next')} className={btn}>&darr;</button>
          <button onClick={onClose} aria-label={t('search.close')} title={t('search.close')} className={btn}>&times;</button>
        </div>
        {status && (
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-text-dim">
            <span aria-live="polite">{status}</span>
            {hits.length > 0 && !showList && (
              <button onClick={() => setShowList(true)} className="text-accent hover:underline">{t('search.showAll')}</button>
            )}
          </div>
        )}
        {showList && hits.length > 0 && (
          <ol aria-label={t('search.results')} className="mt-2 max-h-[min(20rem,50dvh)] overflow-y-auto divide-y divide-border">
            {hits.slice(0, LIST_LIMIT).map((hit, i) => {
              const s = snippet(chapters[hit.chapterIdx].content, hit)
              return (
                <li key={`${hit.chapterIdx}-${hit.start}`}>
                  <button onClick={() => go(i)} className="w-full text-left px-2 py-2 rounded hover:bg-surface-hover transition">
                    <span className="block text-xs text-text-dim truncate">{chapters[hit.chapterIdx].title}</span>
                    <span className="block text-sm text-text-muted">
                      {s.before}<mark className="bg-warning/40 text-text rounded-sm">{s.match}</mark>{s.after}
                    </span>
                  </button>
                </li>
              )
            })}
            {hits.length > LIST_LIMIT && (
              <li className="px-2 py-2 text-xs text-text-dim">
                {t('search.limited', { shown: LIST_LIMIT, total: hits.length })}
              </li>
            )}
          </ol>
        )}
      </div>
    </div>
  )
}
