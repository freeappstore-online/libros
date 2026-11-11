import { retryLocalWrites, usePendingLocalWrites } from '../hooks/localStorage'
import { t } from '../locales'

export function StorageWarning() {
  const count = usePendingLocalWrites()
  if (!count) return null
  return (
    <aside role="alert" className="fixed right-4 left-4 sm:left-auto sm:max-w-sm z-90 rounded-xl border border-danger bg-surface p-4 shadow-xl text-sm"
      style={{ bottom: 'calc(max(var(--player-h, 0px), env(safe-area-inset-bottom)) + 1rem)' }}>
      <p className="font-medium text-danger">{t('storage.title')}</p>
      <p className="mt-2 text-text-muted">{t('storage.text')}</p>
      <button onClick={retryLocalWrites} className="mt-3 min-h-10 px-3 rounded-lg bg-accent text-white">{t('storage.retry')}</button>
    </aside>
  )
}
