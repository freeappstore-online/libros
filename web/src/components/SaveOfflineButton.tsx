import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getManifestExtras, preparedCount, usePreparedManifest, VOICE } from '../hooks/preparedAudio'
import {
  checkSavedText, estimateAudioBytes, formatBytes, saveBook, updateReason, useOfflineBooks, useOnline,
} from '../hooks/offlineBooks'
import { t } from '../locales'

/**
 * Save a book on this device (books#7). A narrated book saves its text and
 * every narrated chapter; a book without narration saves its text only.
 */
export function SaveOfflineButton({ slug }: { slug: string }) {
  const { saved, jobs, errors } = useOfflineBooks()
  const saving = Boolean(jobs[slug])
  const wasSaving = useRef(saving)
  const [status, setStatus] = useState('')

  // Announce when saving starts and how it ends, not every percent (books#15)
  useEffect(() => {
    if (saving === wasSaving.current) return
    wasSaving.current = saving
    setStatus(t(saving ? 'save.statusSaving' : errors[slug] ? 'save.statusFailed' : saved[slug] ? 'save.statusSaved' : 'save.statusCancelled'))
  }, [saving, saved, errors, slug])

  return (
    <>
      <SaveOfflineControl slug={slug} />
      <span role="status" className="sr-only">{status}</span>
    </>
  )
}

function SaveOfflineControl({ slug }: { slug: string }) {
  const { saved, jobs, errors } = useOfflineBooks()
  const manifest = usePreparedManifest()
  const online = useOnline()
  const job = jobs[slug]
  const book = saved[slug]

  useEffect(() => { if (online) checkSavedText(slug) }, [slug, online])

  if (job) {
    return (
      <button
        onClick={job.cancel}
        className="min-h-10 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/20 text-accent hover:bg-danger/20 hover:text-danger transition"
        title={t('save.cancelTitle')}
      >
        {t('save.progress', { pct: Math.round(job.progress * 100) })}
      </button>
    )
  }

  // Until the manifest loads it isn't known whether the book has narration
  if (!manifest) return null
  const narrated = preparedCount(manifest, slug)

  if (book) {
    const reason = updateReason(slug, book, manifest)
    if (reason === t('update.missing') && !online) {
      return <span className="text-xs text-warning">{t('save.incomplete')}</span>
    }
    if (reason && online) {
      return (
        <button
          onClick={() => saveBook(slug, book.voice)}
          className="min-h-10 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-hover text-accent hover:text-text transition"
          title={t('save.updateTitle', { reason })}
        >
          {t(errors[slug] ? 'save.retryUpdate' : 'save.update')}
        </button>
      )
    }
    return (
      <Link
        to="/library"
        className="min-h-10 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-success/15 text-success transition"
        title={t('save.savedTitle')}
      >
        {t('offline.saved')}
      </Link>
    )
  }

  if (!online) return null
  const estimate = estimateAudioBytes(manifest, slug, VOICE, getManifestExtras())
  return (
    <button
      onClick={() => saveBook(slug, narrated > 0 ? VOICE : null)}
      className="min-h-10 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-hover text-text-muted hover:text-accent transition"
      title={narrated > 0 ? t('save.audioTitle', { size: formatBytes(estimate) }) : t('save.textTitle')}
    >
      {errors[slug] ? t('save.retry') : narrated > 0
        // Phones have no room for the size next to Aa, Ch and Play; it is in the title
        ? <>{t('save.save')}<span className="hidden sm:inline">&nbsp;{t('save.size', { size: formatBytes(estimate) })}</span></>
        : t('save.saveText')}
    </button>
  )
}

/** Why the last save or update of this book failed, under the reader's header. */
export function SaveOfflineError({ slug }: { slug: string }) {
  const { errors, jobs } = useOfflineBooks()
  if (!errors[slug] || jobs[slug]) return null
  return (
    <div role="alert" className="border-b border-border bg-danger/10 px-4 py-3 text-center text-sm text-danger">
      {t('save.error', { error: errors[slug] })}
    </div>
  )
}
