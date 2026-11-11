import { useEffect, useRef, useState } from 'react'
import { pwa } from '../fas-capabilities/pwa'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useOfflineBooks } from '../hooks/offlineBooks'
import { reloadWithAppUpdate } from '../hooks/appUpdate'
import { t } from '../locales'

/** An open app looks for a new version this often, and whenever it comes back to the foreground. */
const UPDATE_CHECK_MS = 60 * 60 * 1000

/**
 * "New version available · Reload" (books#24). The SDK runtime (startPwa)
 * registers the service worker, which waits until the user agrees; this toast
 * replaces its unstyled two-step notice. Nothing reloads unless Reload is
 * pressed, so playback is never cut off by an update.
 */
export function UpdateToast() {
  const [ready, setReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [failed, setFailed] = useState(false)
  const { playing } = useAudioPlayer()
  const { jobs } = useOfflineBooks()
  const saving = Object.keys(jobs).length > 0
  const savingRef = useRef(saving)
  savingRef.current = saving
  const registration = useRef<ServiceWorkerRegistration>(undefined)

  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!import.meta.env.PROD || !sw) return
    let disposed = false
    let controller = sw.controller
    let activated = false
    const workers = new Set<ServiceWorker>()
    const watch = () => { void check() }
    const check = async () => {
      const reg = await sw.getRegistration().catch(() => undefined)
      if (disposed) return
      if (reg !== registration.current) {
        registration.current?.removeEventListener('updatefound', watch)
        registration.current = reg
        reg?.addEventListener('updatefound', watch)
      }
      const worker = reg?.installing
      if (worker && !workers.has(worker)) {
        workers.add(worker)
        worker.addEventListener('statechange', watch)
      }
      setReady(Boolean(reg?.waiting) || activated || Boolean(controller && reg?.active && reg.active !== controller))
    }
    const changed = () => {
      const next = sw.controller
      // First installation is a baseline, not a new version. Later changes count.
      if (controller && next && next !== controller) activated = true
      controller = next
      void check()
    }
    void pwa.ready.then(check)
    sw.addEventListener('controllerchange', changed)
    // Without this an app left open (or kept in the background on a phone) never sees a deploy
    const look = async () => {
      if (document.visibilityState !== 'visible') return
      await check()
      if (!disposed) await registration.current?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', look)
    const id = setInterval(look, UPDATE_CHECK_MS)
    return () => {
      disposed = true
      registration.current?.removeEventListener('updatefound', watch)
      for (const worker of workers) worker.removeEventListener('statechange', watch)
      sw.removeEventListener('controllerchange', changed)
      document.removeEventListener('visibilitychange', look)
      clearInterval(id)
    }
  }, [])

  if (!ready || dismissed) return null

  async function reload() {
    if (saving || reloading) return
    setReloading(true)
    setFailed(false)
    const sw = navigator.serviceWorker
    if (!sw) window.location.reload()
    else if (!await reloadWithAppUpdate(sw, () => {
      // Saving may have started while activation was in flight.
      if (savingRef.current) setReloading(false)
      else window.location.reload()
    })) {
      setFailed(true)
      setReloading(false)
    }
  }

  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 z-[60] w-[min(26rem,calc(100vw-2rem))] flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg"
      // Above the player bar, whatever its height; the bar's height already includes the
      // home-indicator inset, so that inset counts only without a bar
      style={{ bottom: 'calc(max(var(--player-h, 0px), env(safe-area-inset-bottom)) + 1rem)' }}
    >
      <span className="flex-1 min-w-0">
        {t('update.available')}
        {playing && <span className="block text-xs text-text-dim">{t('update.stopsPlayback')}</span>}
        {saving && <span className="block text-xs text-text-dim">{t('update.afterSaving')}</span>}
        {failed && <span className="block text-xs text-warning">{t('update.failed')}</span>}
      </span>
      <button
        onClick={reload}
        disabled={saving || reloading}
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-btn-text hover:bg-accent-hover disabled:opacity-40 transition"
      >
        {t(reloading ? 'update.reloading' : 'update.reload')}
      </button>
      <button onClick={() => setDismissed(true)} disabled={reloading} aria-label={t('update.notNow')} className="shrink-0 p-1 text-text-dim hover:text-text transition">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
  )
}
