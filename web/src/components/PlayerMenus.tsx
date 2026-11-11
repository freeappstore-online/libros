import { useEffect, useRef, useState } from 'react'
import { RATES, type SleepChoice, type SleepTimer } from '../hooks/useAudioPlayer'
import { loadSleepChoice } from '../hooks/audioStorage'
import { t } from '../locales'

/** The player bar's speed and sleep timer buttons, each with its popover menu. */

/** Speeds a tap cycles through; long-press or right-click lists every rate. */
const QUICK_RATES = [0.75, 1, 1.25, 1.5, 2]

export function SpeedButton({ rate, setRate }: { rate: number; setRate: (r: number) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = () => { setMenuOpen(false); buttonRef.current?.focus() }
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const longPressed = useRef(false)

  function cycle() {
    if (longPressed.current) { longPressed.current = false; return }
    setRate(QUICK_RATES.find(r => r > rate) ?? QUICK_RATES[0])
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={cycle}
        onPointerDown={() => {
          longPressed.current = false
          pressTimer.current = setTimeout(() => { longPressed.current = true; setMenuOpen(true) }, 500)
        }}
        onPointerUp={() => clearTimeout(pressTimer.current)}
        onPointerLeave={() => clearTimeout(pressTimer.current)}
        onContextMenu={e => { e.preventDefault(); setMenuOpen(true) }}
        className="min-w-[40px] sm:min-w-11 h-[40px] px-1 sm:px-1.5 text-xs font-semibold tabular-nums text-text-muted hover:text-text transition select-none [-webkit-touch-callout:none]"
        title={t('player.speedTitle')}
        aria-label={`${t('listening.speed')} ${t('player.rate', { rate })}`}
        aria-keyshortcuts="[ ]"
      >
        {t('player.rate', { rate })}
      </button>
      {menuOpen && (
        <BarMenu label={t('listening.speed')} onClose={close}>
          {RATES.map(r => (
            <MenuItem key={r} checked={r === rate} onClick={() => { setRate(r); close() }}>
              {t('player.rate', { rate: r })}
            </MenuItem>
          ))}
        </BarMenu>
      )}
    </div>
  )
}

const SLEEP_CHOICES: SleepChoice[] = [5, 15, 30, 45, 60, 'chapter']

const sleepLabel = (c: SleepChoice) => c === 'chapter' ? t('sleep.endOfChapter') : t('sleep.minutes', { count: c })

/** Moon button: picks a sleep timer, then shows its countdown; tapping that cancels or extends it. */
export function SleepButton({ timer, start, extend, cancel }: {
  timer: SleepTimer | null
  start: (c: SleepChoice) => void
  extend: (minutes: number) => void
  cancel: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const last = menuOpen ? loadSleepChoice() : null
  const close = () => { setMenuOpen(false); buttonRef.current?.focus() }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setMenuOpen(!menuOpen)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`flex items-center justify-center gap-1 min-w-[40px] h-[40px] px-2 text-xs font-semibold tabular-nums transition ${timer ? 'text-accent' : 'text-text-muted hover:text-text'}`}
        title={t('sleep.title')}
        aria-label={timer
          ? t('sleep.set', { until: timer.choice === 'chapter' ? t('sleep.endOfChapterLower') : formatTime(timer.remaining / 1000) })
          : t('sleep.title')}
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.3 2a10 10 0 1 0 9.7 12.6A8 8 0 0 1 12.3 2z"/></svg>
        {timer && <span>{timer.choice === 'chapter' ? t('sleep.chapterShort') : formatTime(timer.remaining / 1000)}</span>}
      </button>
      {menuOpen && (
        <BarMenu label={t('sleep.title')} onClose={close}>
          {timer && timer.choice !== 'chapter' && (
            <>
              <MenuItem onClick={() => { extend(5); close() }}>{t('sleep.extend', { count: 5 })}</MenuItem>
              <MenuItem onClick={() => { extend(15); close() }}>{t('sleep.extend', { count: 15 })}</MenuItem>
            </>
          )}
          {timer && <MenuItem onClick={() => { cancel(); close() }}>{t('sleep.off')}</MenuItem>}
          {timer && <div role="separator" className="my-1 border-t border-border" />}
          {SLEEP_CHOICES.map(c => (
            <MenuItem key={c} checked={timer ? timer.choice === c : last === c} onClick={() => { start(c); close() }}>
              {sleepLabel(c)}
            </MenuItem>
          ))}
        </BarMenu>
      )}
    </div>
  )
}

/**
 * Popover above a bar button; a click outside closes it. Keyboard (books#15): focus moves
 * into it, arrows/Home/End move between items, Escape or Tab closes it (onClose returns focus).
 */
function BarMenu({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const menu = menuRef.current
    ;(menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus()
  }, [])

  function onKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (j: number) => items[(j + items.length) % items.length]?.focus()
    const keys: Record<string, () => void> = {
      Escape: onClose, Tab: onClose,
      ArrowDown: () => go(i + 1), ArrowUp: () => go(i - 1), Home: () => go(0), End: () => go(items.length - 1),
    }
    if (!keys[e.key]) return
    e.preventDefault()
    keys[e.key]()
  }

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div ref={menuRef} role="menu" aria-label={label} onKeyDown={onKeyDown} className="absolute bottom-full right-0 mb-2 z-20 max-h-[min(18rem,60dvh)] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg py-1">
        {children}
      </div>
    </>
  )
}

function MenuItem({ checked, onClick, children }: { checked?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      tabIndex={-1}
      aria-checked={checked}
      onClick={onClick}
      className={`block w-full min-h-10 whitespace-nowrap px-4 py-2 text-left text-sm tabular-nums transition ${
        checked ? 'text-accent font-semibold' : 'text-text-muted hover:bg-surface-hover hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
