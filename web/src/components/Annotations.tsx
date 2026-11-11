import { useState } from 'react'
import { topInset } from './ChapterText'
import {
  HIGHLIGHT_COLORS, formatSeconds, removeAnnotation, sortAnnotations, updateAnnotation,
  type Annotation, type HighlightColor,
} from '../hooks/annotations'
import { LOCALE, t } from '../locales'

export function BookmarkIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  )
}

/** A colour's name inside a sentence: "Highlight yellow" */
const colorName = (c: HighlightColor) => t(`color.${c}`).toLocaleLowerCase(LOCALE.language)

/** Delete, asking first when there is a note to lose. */
function deleteAnnotation(slug: string, a: Annotation): boolean {
  if (a.note && !window.confirm(t('notes.deleteConfirm'))) return false
  removeAnnotation(slug, a.id)
  return true
}

/** A book's bookmarks and highlights in reading order: go to, edit, delete (books#11). */
export function AnnotationList({ slug, list, chapterTitles, onJump }: {
  slug: string
  list: Annotation[]
  chapterTitles: string[]
  onJump: (a: Annotation) => void
}) {
  const [editing, setEditing] = useState<Annotation | null>(null)
  const link = 'min-h-10 text-xs text-text-muted hover:text-text transition'

  return (
    <>
      <ol className="divide-y divide-border">
        {sortAnnotations(list).map(a => (
          <li key={a.id} className="py-2.5 flex gap-3">
            <span className="mt-1 shrink-0 text-accent">
              {a.kind === 'bookmark'
                ? <BookmarkIcon size={14} />
                : <span className={`block w-3.5 h-3.5 rounded-full ${HIGHLIGHT_COLORS[a.color ?? 'yellow'].className}`} />}
            </span>
            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <div className="text-xs text-text-dim truncate">
                {chapterTitles[a.chapterIdx] ?? t('chapter.full', { chapter: a.chapterIdx + 1 })}
                {a.seconds !== undefined && ` · ${formatSeconds(a.seconds)}`}
                {a.stale && <span className="text-warning"> · {t('notes.textChanged')}</span>}
              </div>
              <button onClick={() => onJump(a)} className="block w-full text-left text-sm text-text-muted hover:text-text transition line-clamp-3">
                {a.kind === 'highlight' ? t('notes.quote', { text: a.text }) : a.text}
              </button>
              {a.note && <p className="mt-1 text-sm italic text-text whitespace-pre-wrap">{a.note}</p>}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                <button onClick={() => onJump(a)} className={link}>{t('notes.goTo')}</button>
                <button onClick={() => setEditing(a)} className={link}>{t(a.note ? 'notes.edit' : 'notes.addNote')}</button>
                <button onClick={() => deleteAnnotation(slug, a)} className="min-h-10 text-xs text-text-muted hover:text-danger transition">{t('notes.delete')}</button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {editing && <AnnotationEditor slug={slug} annotation={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/**
 * Offered under selected chapter text: highlight it in a colour, or with a note.
 * Below the selection, clear of the phone's own selection menu above it.
 */
export function HighlightToolbar({ rect, onHighlight }: { rect: DOMRect; onHighlight: (color: HighlightColor, withNote: boolean) => void }) {
  const width = 240
  const height = 60
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8)
  // Below the selection, clear of the iOS/Android selection handle (touch) and of the iOS edit
  // menu, which sits above it; above the selection instead when the fixed player is in the way
  const gap = matchMedia('(pointer: coarse)').matches ? 32 : 8
  const player = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--player-h')) || 0
  const limit = window.innerHeight - player - height
  // Hidden while the selection is scrolled under the sticky header or the player
  const header = topInset()
  if (rect.bottom < header || rect.top > window.innerHeight - player) return null
  const top = rect.bottom + gap <= limit ? rect.bottom + gap : Math.max(header + 8, Math.min(limit, rect.top - gap - height))
  return (
    <div
      role="toolbar"
      aria-label={t('notes.highlight')}
      // Keep the selection while pressing the buttons
      onMouseDown={e => e.preventDefault()}
      className="fixed z-50 flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 shadow-xl"
      style={{ left, top, width }}
    >
      {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map(c => (
        <button
          key={c}
          onClick={() => onHighlight(c, false)}
          aria-label={t('notes.highlightIn', { color: colorName(c) })}
          title={t('notes.highlightIn', { color: colorName(c) })}
          className={`w-9 h-9 rounded-full border border-border ${HIGHLIGHT_COLORS[c].className}`}
        />
      ))}
      <button onClick={() => onHighlight('yellow', true)} className="ml-auto min-h-10 px-2 text-sm font-semibold text-accent hover:text-accent-hover transition">
        {t('notes.note')}
      </button>
    </div>
  )
}

/** Colour and note of a highlight, or the note of a bookmark. */
export function AnnotationEditor({ slug, annotation, onClose }: { slug: string; annotation: Annotation; onClose: () => void }) {
  const [note, setNote] = useState(annotation.note ?? '')
  const [color, setColor] = useState<HighlightColor>(annotation.color ?? 'yellow')
  const save = () => {
    updateAnnotation(slug, annotation.id, annotation.kind === 'highlight' ? { note: note.trim() || undefined, color } : { note: note.trim() || undefined })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(annotation.kind === 'highlight' ? 'notes.editHighlight' : 'notes.editBookmark')}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-4 shadow-xl text-left"
      >
        <p className="text-sm text-text-muted line-clamp-4 mb-3">
          {annotation.kind === 'highlight' ? t('notes.quote', { text: annotation.text }) : annotation.text}
        </p>
        {annotation.kind === 'highlight' && (
          <div className="flex items-center gap-2 mb-3" role="radiogroup" aria-label={t('notes.highlightColour')}>
            {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map(c => (
              <button
                key={c}
                role="radio"
                aria-checked={color === c}
                aria-label={t(`color.${c}`)}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 ${HIGHLIGHT_COLORS[c].className} ${color === c ? 'border-text' : 'border-transparent'}`}
              />
            ))}
          </div>
        )}
        <textarea
          autoFocus
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={t('notes.placeholder')}
          aria-label={t('notes.note')}
          rows={4}
          className="w-full bg-page border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim focus:outline-none focus:border-accent transition"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            onClick={() => { if (deleteAnnotation(slug, annotation)) onClose() }}
            className="text-sm text-text-muted hover:text-danger transition"
          >
            {t('notes.delete')}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm border border-border text-text-muted hover:text-text transition">{t('common.cancel')}</button>
            <button onClick={save} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent hover:bg-accent-hover text-btn-text transition">{t('common.save')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
