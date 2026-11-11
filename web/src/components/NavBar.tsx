import { Link, useLocation } from 'react-router-dom'
import { useOnline } from '../hooks/offlineBooks'
import { EDITION } from '../data/edition'
import { t } from '../locales'

interface Props {
  /** Optional title shown next to back button (e.g. book title) */
  title?: string
  /** Optional subtitle (e.g. author, genre) */
  subtitle?: string
  /** Right-side actions (e.g. Listen button, chapter toggle) */
  actions?: React.ReactNode
}

export function NavBar({ title, subtitle, actions }: Props) {
  const pathname = useLocation().pathname.replace(/\/+$/, '') || '/'

  const isHome = pathname === '/'
  const pageTitle = isHome ? EDITION.name : pathname === '/library' ? t('nav.myBooks')
    : pathname === '/settings' ? t('nav.settings') : null
  const showTitle = Boolean(title && title !== pageTitle)
  const online = useOnline()

  return (
    <header className="relative border-b border-border px-4 md:px-6 py-2.5 md:py-3">
      {/* Phones and tablets: logo, title and nav, then the actions on a row of their own */}
      <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-x-3 gap-y-2">
        {/* Left: logo/back + nav links */}
        {/* Only a title may shrink (it truncates): without one the logo would slide under the Offline badge */}
        <div className={`flex flex-1 items-center gap-3 md:gap-5 ${showTitle ? 'min-w-0' : 'min-w-fit'}`}>
          {/* Logo — always visible, always links home */}
          <Link to="/" aria-current={isHome ? 'page' : undefined} className="text-lg md:text-xl font-display hover:text-accent transition shrink-0">
            {EDITION.name}
          </Link>

          {/* Nav links — desktop only */}
          <nav aria-label={t('nav.main')} className="hidden md:flex items-center gap-4 text-sm whitespace-nowrap">
            <Link
              to="/library"
              aria-current={pathname === '/library' ? 'page' : undefined}
              className={`transition ${pathname === '/library' ? 'text-text font-medium' : 'text-text-muted hover:text-text'}`}
            >
              {t('nav.myBooks')}
            </Link>
            <Link
              to="/settings"
              aria-current={pathname === '/settings' ? 'page' : undefined}
              className={`transition ${pathname === '/settings' ? 'text-text font-medium' : 'text-text-muted hover:text-text'}`}
            >
              {t('nav.settings')}
            </Link>
          </nav>

          {/* Page title (reader, book editor, etc) */}
          {/* Mobile navigation uses icons, so its page name remains visible. */}
          {title && !showTitle && <h1 className="text-sm font-medium md:sr-only">{title}</h1>}
          {showTitle && (
            <>
              <span className="text-text-dim hidden md:inline">/</span>
              <div className="min-w-0">
                <h1 className="text-sm md:text-base font-medium truncate">{title}</h1>
                {subtitle && <div className="text-xs text-text-dim truncate">{subtitle}</div>}
              </div>
            </>
          )}
        </div>

        {!online && (
          <span className="shrink-0 px-2 py-1 rounded-full text-[11px] font-semibold bg-warning/15 text-warning" title={t('nav.offlineHint')}>
            {t('nav.offline')}
          </span>
        )}

        {/* Right: actions (own row below lg) */}
        {actions && (
          <div className="order-last lg:order-none w-full lg:w-auto flex flex-wrap items-center justify-end gap-2 md:gap-3 shrink-0">
            {actions}
          </div>
        )}

        {/* Mobile nav icons */}
        <nav aria-label={t('nav.main')} className="flex md:hidden items-center shrink-0">
          <Link
            to="/library"
            className={`w-10 h-10 flex items-center justify-center rounded-lg transition ${pathname === '/library' ? 'text-text' : 'text-text-dim hover:text-text-muted'}`}
            title={t('nav.myBooks')}
            aria-label={t('nav.myBooks')}
            aria-current={pathname === '/library' ? 'page' : undefined}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          </Link>
          <Link
            to="/settings"
            className={`w-10 h-10 flex items-center justify-center rounded-lg transition ${pathname === '/settings' ? 'text-text' : 'text-text-dim hover:text-text-muted'}`}
            title={t('nav.settings')}
            aria-label={t('nav.settings')}
            aria-current={pathname === '/settings' ? 'page' : undefined}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          </Link>
        </nav>
      </div>
    </header>
  )
}
