import { useEffect, useRef } from 'react'
import { useAudioPlayer, RATES } from '../hooks/useAudioPlayer'
import { t } from '../locales'

/**
 * App-wide keyboard shortcuts (books#15) and the "?" help listing them.
 * Pages opt controls in with data-shortcut: "play" (starts listening when nothing is
 * loaded yet), "follow" (Follow audio) and "search" (the page's search field, for "/").
 */
const SPACE = t('keys.space')
const SHIFT = t('keys.shift')
const SHORTCUTS: [string[], string][] = [
  [[SPACE, 'K'], t('shortcuts.playPause')],
  [['←'], t('player.back')],
  [['→'], t('player.forward')],
  [[SHIFT, '←'], t('player.previousChapter')],
  [[SHIFT, '→'], t('player.nextChapter')],
  [['['], t('shortcuts.slower')],
  [[']'], t('shortcuts.faster')],
  [['F'], t('shortcuts.follow')],
  [['/'], t('shortcuts.search')],
  [['?'], t('shortcuts.help')],
]

/** Elements whose keys are their own, not shortcuts (also for the reader's "/"). */
export const KEEPS_KEYS = 'input, textarea, select, [contenteditable="true"], [role="menu"], [role="toolbar"], [role="dialog"], dialog'

export function KeyboardShortcuts() {
  const player = useAudioPlayer()
  const playerRef = useRef(player)
  playerRef.current = player
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    /** Click the page's control for a shortcut; false when the page has none. */
    const click = (name: string) => {
      const el = document.querySelector<HTMLElement>(`[data-shortcut="${name}"]`)
      el?.click()
      return Boolean(el)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      // Typing, a slider, a select or an open menu, toolbar or dialog keeps its keys
      if (target.closest(KEEPS_KEYS)) return
      const p = playerRef.current
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      let handled = true
      if (key === ' ' || key === 'k') {
        // Space on a focused button or link activates it instead
        if (key === ' ' && target.closest('button, a, [role="button"]')) return
        if (p.book) {
          if (p.playing) p.pause()
          else p.play()
        } else {
          // No play control (nothing to listen to here): Space scrolls the page as usual
          handled = click('play')
        }
      } else if ((key === 'ArrowLeft' || key === 'ArrowRight') && p.book) {
        const forward = key === 'ArrowRight'
        if (e.shiftKey) {
          if (forward) p.nextChapter()
          else p.prevChapter()
        } else {
          p.skip(forward ? 30 : -15)
        }
      } else if ((key === '[' || key === ']') && p.book) {
        const i = RATES.indexOf(p.rate)
        const next = RATES[Math.min(RATES.length - 1, Math.max(0, (i < 0 ? RATES.indexOf(1) : i) + (key === ']' ? 1 : -1)))]
        p.setRate(next)
      } else if (key === 'f') {
        click('follow')
      } else if (key === '/') {
        const search = document.querySelector<HTMLElement>('[data-shortcut="search"]')
        if (search) search.focus()
        else handled = false
      } else if (key === '?') {
        dialogRef.current?.showModal()
      } else {
        handled = false
      }
      if (handled) e.preventDefault()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="shortcuts-title"
      className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-5 text-text shadow-xl backdrop:bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) dialogRef.current?.close() }}
      // A modal: Close is its only control, so Tab stays on it rather than leaving the page
      onKeyDown={e => { if (e.key === 'Tab') e.preventDefault() }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="shortcuts-title" className="text-lg font-display">{t('shortcuts.title')}</h2>
        <button
          onClick={() => dialogRef.current?.close()}
          className="rounded-lg px-2 py-1 text-sm text-text-muted hover:bg-surface-hover hover:text-text transition"
        >
          {t('common.close')}
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={what} className="contents">
            <dt className="whitespace-nowrap">
              {keys.map((k, i) => (
                <span key={k}>
                  {i > 0 && <span className="text-text-muted">{keys[0] === SHIFT ? ' + ' : ` ${t('shortcuts.or')} `}</span>}
                  <kbd className="rounded border border-border bg-page px-1.5 py-0.5 font-code text-xs">{k}</kbd>
                </span>
              ))}
            </dt>
            <dd className="text-text-muted">{what}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  )
}
