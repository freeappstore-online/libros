import { Fragment, memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useReadAlong } from '../hooks/useAudioPlayer'
import type { CharRange } from '../hooks/readAlong'
import { t } from '../locales'

// Room kept clear above and below the spoken line, the latter above the fixed player bar
const TOP_MARGIN = 48
const BOTTOM_MARGIN = 40

/** Bottom of the page's sticky top bar ([data-reader-top]), which covers the text under it. */
export function topInset(): number {
  return Math.max(0, document.querySelector('[data-reader-top]')?.getBoundingClientRect().bottom ?? 0)
}

/** Paragraphs that together are exactly `text`, so DOM text offsets stay chapter offsets. */
function splitBlocks(text: string): { start: number; end: number; text: string }[] {
  const blocks: { start: number; end: number; text: string }[] = []
  let start = 0
  const push = (end: number) => {
    blocks.push({ start, end, text: text.slice(start, end) })
    start = end
  }
  for (const m of text.matchAll(/\n\s*\n/g)) push(m.index + m[0].length)
  if (start < text.length) push(text.length)
  return blocks
}

/** A range marked in the text besides the read-along: a search match or a reader's highlight. */
export interface TextMark {
  start: number
  end: number
  /** Classes of the <mark> */
  className: string
  /** data-mark attribute, to find the mark ("search", or a highlight's id) */
  id: string
}

const NO_MARKS: TextMark[] = []

/**
 * One paragraph. Highlight bounds are relative to the paragraph (empty when it
 * holds none), so a moving highlight re-renders only the paragraphs it enters or leaves.
 * `marks` are relative to the paragraph too and keep their identity while they don't change.
 * A block of its own, so that change re-lays out one paragraph, not the whole chapter.
 */
const Block = memo(function Block({ text, s0, s1, w0, w1, marks }: {
  text: string; s0: number; s1: number; w0: number; w1: number; marks: TextMark[]
}) {
  if (s0 >= s1 && w0 >= w1 && marks.length === 0) return <span className="block">{text}</span>
  const cuts = [...new Set([0, s0, s1, w0, w1, text.length, ...marks.flatMap(m => [m.start, m.end])])]
    .filter(c => c >= 0 && c <= text.length)
    .sort((a, b) => a - b)
  const pieces = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]]
    let piece: ReactNode = text.slice(a, b)
    if (a >= w0 && b <= w1) {
      piece = <mark data-readalong="word" className="bg-accent/35 text-text rounded-sm">{piece}</mark>
    } else if (a >= s0 && b <= s1) {
      piece = <span data-readalong="sentence" className="bg-accent/10 rounded-sm">{piece}</span>
    }
    // Marks wrap the read-along, so the spoken word still shows inside a highlight
    for (const m of marks) {
      if (a >= m.start && b <= m.end) piece = <mark data-mark={m.id} className={`text-text ${m.className}`}>{piece}</mark>
    }
    pieces.push(<Fragment key={a}>{piece}</Fragment>)
  }
  return <span className="block">{pieces}</span>
})

function clip(range: CharRange | null, start: number, end: number): [number, number] {
  if (!range || range[1] <= start || range[0] >= end) return [0, 0]
  return [Math.max(range[0], start) - start, Math.min(range[1], end) - start]
}

/** Chapter offset of a DOM position inside the ChapterText container. */
export function textOffset(container: Node, node: Node, offset: number): number {
  const r = document.createRange()
  r.setStart(container, 0)
  r.setEnd(node, offset)
  return r.toString().length
}

/** The text node and offset at chapter offset `offset`. */
function domPosition(container: Node, offset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let total = 0
  let n: Node | null
  while ((n = walker.nextNode())) {
    const len = n.textContent?.length ?? 0
    if (total + len > offset) return { node: n, offset: offset - total }
    total += len
  }
  return null
}

interface Props {
  content: string
  chapterIdx: number
  /** This book is the one playing: show its read-along position when it is in this chapter */
  active: boolean
  className?: string
  style?: CSSProperties
  title?: string
  onClick?: (e: MouseEvent) => void
  /** Search matches and highlights, in chapter offsets */
  marks?: TextMark[]
  /** Scroll to this chapter offset; each new object scrolls again */
  focus?: { offset: number } | null
}

/** Chapter text that highlights the spoken word and sentence and keeps them in view. */
export function ChapterText({ content, chapterIdx, active, className, style, title, onClick, marks = NO_MARKS, focus }: Props) {
  const blocks = useMemo(() => splitBlocks(content), [content])
  // Marks per paragraph, recomputed when the marks change, not as the read-along moves
  const blockMarks = useMemo(() => blocks.map(({ start, end }) => {
    const inside = marks.filter(m => m.start < end && m.end > start)
    return inside.length === 0
      ? NO_MARKS
      : inside.map(m => ({ ...m, start: Math.max(m.start, start) - start, end: Math.min(m.end, end) - start }))
  }), [blocks, marks])
  const pos = useReadAlong()
  const hl = active && pos?.chapterIdx === chapterIdx ? pos : null
  const containerRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const hasHighlight = Boolean(hl)
  const hasHighlightRef = useRef(hasHighlight)
  hasHighlightRef.current = hasHighlight

  useEffect(() => { setFollowing(true) }, [chapterIdx])

  // Text the reader is selecting, in chapter offsets. Re-rendering a paragraph replaces its
  // text nodes and loses the selection, so the read-along stands still in the paragraphs it
  // covers until it is cleared (books#26)
  const [selected, setSelected] = useState<[number, number] | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection()
      const container = containerRef.current
      const range = sel && !sel.isCollapsed && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
      const next: [number, number] | null = range && container && container.contains(range.commonAncestorContainer)
        ? [textOffset(container, range.startContainer, range.startOffset), textOffset(container, range.endContainer, range.endOffset)]
        : null
      setSelected(prev => (prev?.[0] === next?.[0] && prev?.[1] === next?.[1] ? prev : next))
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [])
  // What each paragraph last showed of the read-along, to keep while it is selected
  const shown = useRef<{ blocks: typeof blocks; at: number[][] }>({ blocks, at: [] })
  if (shown.current.blocks !== blocks) shown.current = { blocks, at: [] }

  // Scrolling by hand stops following until "Follow audio" (or a click on the text)
  useEffect(() => {
    const stop = () => { if (hasHighlightRef.current) setFollowing(false) }
    const onKey = (e: KeyboardEvent) => {
      // Space as play/pause (KeyboardShortcuts) is not a scroll
      if (e.defaultPrevented) return
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) stop()
    }
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchmove', stop, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchmove', stop)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Jump to a search match, bookmark or highlight: show it in the upper third of the screen
  useEffect(() => {
    const container = containerRef.current
    const at = focus && container ? domPosition(container, focus.offset) : null
    if (!at) return
    if (hasHighlightRef.current) setFollowing(false)
    const r = document.createRange()
    r.setStart(at.node, at.offset)
    r.setEnd(at.node, Math.min(at.offset + 1, at.node.textContent?.length ?? 0))
    const rect = r.getBoundingClientRect()
    const below = Math.max(window.innerHeight / 3, topInset() + TOP_MARGIN)
    window.scrollTo({ top: window.scrollY + rect.top - below, behavior: 'instant' })
  }, [focus])

  // Keep the spoken line in view; scroll only once it leaves the comfortable area
  const target = hl?.word ?? hl?.sentence
  const targetStart = target?.[0] ?? -1
  useEffect(() => {
    // Nor while the reader selects text: the selection would scroll away
    if (!following || targetStart < 0 || selectedRef.current) return
    const el = containerRef.current?.querySelector('[data-readalong="word"]')
      ?? containerRef.current?.querySelector('[data-readalong="sentence"]')
    if (!el) return
    const rect = el.getBoundingClientRect()
    const player = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--player-h')) || 0
    if (rect.top >= topInset() + TOP_MARGIN && rect.bottom <= window.innerHeight - player - BOTTOM_MARGIN) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [following, targetStart])

  return (
    <>
      <div
        ref={containerRef}
        data-chapter-text=""
        // Break long compounds and source-text rules without altering text offsets or verse newlines.
        className={`[overflow-wrap:anywhere] ${className ?? ''}`}
        style={style}
        title={title}
        onClick={e => { setFollowing(true); onClick?.(e) }}
      >
        {blocks.map(({ start, end, text }, i) => {
          const frozen = selected && selected[0] < end && selected[1] > start ? shown.current.at[i] : undefined
          const [s0, s1, w0, w1] = frozen ?? [...clip(hl?.sentence ?? null, start, end), ...clip(hl?.word ?? null, start, end)]
          shown.current.at[i] = [s0, s1, w0, w1]
          return <Block key={start} text={text} s0={s0} s1={s1} w0={w0} w1={w1} marks={blockMarks[i]} />
        })}
      </div>
      {hl && !following && (
        <button
          onClick={() => setFollowing(true)}
          data-shortcut="follow"
          aria-keyshortcuts="F"
          title={t('reader.followKeys')}
          className="fixed right-4 bottom-[calc(var(--player-h,0px)+1rem)] z-40 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-btn-text shadow-lg hover:bg-accent-hover transition"
        >
          {t('reader.follow')}
        </button>
      )}
    </>
  )
}
