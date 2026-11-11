import { readLocalRecord, writeLocal } from './localStorage'
/**
 * Bookmarks, highlights and notes (books#11), kept on this device per book.
 * Offsets are chapter text offsets, like the read-along and the search.
 */
import { useSyncExternalStore } from 'react'
import { t } from '../locales'

const KEY = 'bp-annotations'

export const HIGHLIGHT_COLORS = {
  yellow: { className: 'bg-yellow-300/50' },
  green: { className: 'bg-green-300/50' },
  pink: { className: 'bg-pink-300/50' },
} as const
export type HighlightColor = keyof typeof HIGHLIGHT_COLORS

export interface Annotation {
  id: string
  kind: 'bookmark' | 'highlight'
  chapterIdx: number
  /** Char range in the chapter; a bookmark is a point (start === end) */
  start: number
  end: number
  /** Narration time of a bookmark made while listening */
  seconds?: number
  color?: HighlightColor
  note?: string
  /** The highlighted text, or the sentence a bookmark is at (its name) */
  text: string
  created: number
  /** A highlight whose text is no longer in its chapter (the book's text changed): listed, not drawn */
  stale?: boolean
}

type Store = Record<string, Annotation[]>

function load(): Store {
  const parsed = readLocalRecord<Annotation[]>(KEY)
  return Object.fromEntries(Object.entries(parsed).filter(([, list]) => Array.isArray(list)))
}

let store: Store = load()
const listeners = new Set<() => void>()

// Another tab (or the installed app beside the browser) changed them
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== KEY && e.key !== null) return
    store = load()
    for (const listener of listeners) listener()
  })
}

/** Read-modify-write from storage, so a change made in another tab isn't overwritten. */
function update(slug: string, fn: (list: Annotation[]) => Annotation[]) {
  store = load()
  const list = fn(store[slug] ?? [])
  if (list.length) store[slug] = list
  else delete store[slug]
  writeLocal(KEY, JSON.stringify(store))
  for (const listener of listeners) listener()
}

export function addAnnotation(slug: string, a: Omit<Annotation, 'id' | 'created'>): Annotation {
  const full = { ...a, id: `${a.kind === 'bookmark' ? 'bm' : 'hl'}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: Date.now() }
  update(slug, list => [...list, full])
  return full
}

export function updateAnnotation(slug: string, id: string, patch: Partial<Pick<Annotation, 'color' | 'note'>>) {
  update(slug, list => list.map(a => (a.id === id ? { ...a, ...patch } : a)))
}

export function removeAnnotation(slug: string, id: string) {
  update(slug, list => list.filter(a => a.id !== id))
}

/**
 * Where a highlight's text is in `content`: its range if the text is still there, else the
 * occurrence nearest its old offset (the text around it changed), else null (its own text changed).
 */
export function anchorHighlight(a: Annotation, content: string): [number, number] | null {
  // Stored trimmed, from a selection that may take in spaces around it
  if (content.slice(a.start, a.end).trim() === a.text) return [a.start, a.end]
  if (!a.text) return null
  let best = -1
  for (let i = content.indexOf(a.text); i >= 0; i = content.indexOf(a.text, i + 1)) {
    if (best < 0 || Math.abs(i - a.start) < Math.abs(best - a.start)) best = i
  }
  return best < 0 ? null : [best, best + a.text.length]
}

/** Move a book's highlights to where their text now is, and mark those whose text is gone (books#26). */
export function reanchorAnnotations(slug: string, chapters: string[]) {
  const move = (a: Annotation): Annotation => {
    if (a.kind !== 'highlight' || a.chapterIdx >= chapters.length) return a
    const at = anchorHighlight(a, chapters[a.chapterIdx])
    if (!at) return a.stale ? a : { ...a, stale: true }
    return at[0] === a.start && at[1] === a.end && !a.stale ? a : { ...a, start: at[0], end: at[1], stale: undefined }
  }
  if ((load()[slug] ?? []).some(a => move(a) !== a)) update(slug, list => list.map(move))
}

/** Every book's annotations, slug → list; re-renders on any change. */
export function useAllAnnotations(): Store {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => store,
  )
}

/** In reading order. */
export function sortAnnotations(list: Annotation[]): Annotation[] {
  return [...list].sort((a, b) => a.chapterIdx - b.chapterIdx || a.start - b.start)
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** The book's bookmarks, highlights and notes as Markdown. */
export function annotationsMarkdown(title: string, author: string, chapterTitles: string[], list: Annotation[]): string {
  const lines = [`# ${title}`, '', `*${author}* · ${t('markdown.subtitle')}`, '']
  let chapter = -1
  for (const a of sortAnnotations(list)) {
    if (a.chapterIdx !== chapter) {
      chapter = a.chapterIdx
      lines.push(`## ${chapterTitles[chapter] ?? t('chapter.full', { chapter: chapter + 1 })}`, '')
    }
    const text = a.text.replace(/\s+/g, ' ').trim()
    if (a.kind === 'bookmark') {
      lines.push(`- ${a.seconds !== undefined ? t('markdown.bookmarkAt', { time: formatSeconds(a.seconds) }) : t('markdown.bookmark')}: ${text}`)
      if (a.note) lines.push(`  ${a.note.replace(/\n/g, '\n  ')}`)
    } else {
      lines.push(`> ${text}`)
      if (a.note) lines.push('', a.note)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** Save the Markdown as a file. */
export function downloadMarkdown(filename: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
