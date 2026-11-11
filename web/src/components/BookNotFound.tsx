import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { pwa } from '../fas-capabilities/pwa'
import { useOfflineBooks } from '../hooks/offlineBooks'
import { newerVersionWaiting, reloadWithAppUpdate } from '../hooks/appUpdate'
import { t } from '../locales'

/**
 * A slug this build doesn't know may be a book added in a newer version that a
 * service worker hasn't let in yet (books#32): switch to that version and
 * reload, and say the book isn't there only when no newer version exists.
 */
export function BookNotFound() {
  const sw = import.meta.env.PROD ? navigator.serviceWorker : undefined
  const { jobs } = useOfflineBooks()
  // Reloading would cut off books being saved for offline
  const saving = Object.keys(jobs).length > 0
  const [checking, setChecking] = useState(Boolean(sw) && !saving)

  useEffect(() => {
    if (!sw || saving) {
      setChecking(false)
      return
    }
    let cancelled = false
    pwa.ready
      .then(() => sw.getRegistration())
      .then(reg => (reg ? newerVersionWaiting(reg) : false))
      .then(async waiting => {
        if (cancelled) return
        if (waiting && await reloadWithAppUpdate(sw, () => { if (!cancelled) window.location.reload() })) return
        if (!cancelled) setChecking(false)
      })
      .catch(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [sw, saving])

  return (
    <div className="min-h-dvh bg-page text-text flex items-center justify-center">
      {checking ? (
        <p role="status" className="text-text-muted">{t('app.loading')}</p>
      ) : (
        <div className="text-center space-y-4">
          <p className="text-xl text-text-muted">{t('app.bookNotFound')}</p>
          <Link to="/" className="text-accent hover:underline">{t('app.browseBooks')}</Link>
        </div>
      )}
    </div>
  )
}
