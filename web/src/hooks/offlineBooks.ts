/**
 * Books saved for offline reading and listening (books#7).
 *
 * Files live in an app-owned Cache Storage bucket, keyed by the URL they came
 * from: the book's text, every prepared narration chapter (.m4a) with its
 * word timings (.timings.json) and spoken title (.title.m4a) when published, plus a copy of the narration
 * manifest so the app knows what's narrated while offline. Which books are
 * saved, and how large each file is, is kept in localStorage.
 */
import { useEffect, useMemo, useState } from 'react'
import { CATALOG } from '../data/catalog'
import { LOCALE, t } from '../locales'
import { coverUrl } from '../components/BookCover'
import type { AudioChapter } from './useAudioPlayer'
import {
  MANIFEST_URL, getManifestExtras, hasTimings, parseManifest, preparedCount, preparedTitleUrl, preparedUrl,
  preparedTimingsUrl, titleSeconds, usePreparedManifest, type ManifestExtras, type PreparedManifest,
} from './preparedAudio'

const CACHE = 'books-offline-v1'
const SAVED_KEY = 'bp-offline-books'
const OFFLINE_CHANGED_EVENT = 'bp-offline-changed'

/**
 * What a save keeps of a book. Saves made with an older format are offered
 * Update, which downloads only what they lack. 2: the text's version (to
 * notice a changed text) and read-along timings published after a chapter
 * was saved (books#24).
 */
const SAVE_FORMAT = 2
/** Attempts per file before a save reports the failure */
const ATTEMPTS = 3

/**
 * Cross-tab locks (Web Locks): saves hold FILES_LOCK shared and their book's
 * lock exclusively, so a book saves in one tab at a time; clearing the files
 * a closed page left behind holds FILES_LOCK exclusively.
 */
const FILES_LOCK = 'bp-offline-files'
const bookLock = (slug: string) => `bp-offline-${slug}`

/** Measured on Alice chapter 1: 3.2 MB for 615 s of AAC. */
const AUDIO_BYTES_PER_SECOND = 5200

export interface SavedBook {
  /** Voice the narration was saved in; null when the book was saved for reading only */
  voice: string | null
  /** Saved file URL → bytes */
  files: Record<string, number>
  savedAt: number
  /** SAVE_FORMAT of the last complete save or update; absent before format 2 */
  format?: number
  /** ETag of the saved text */
  textVersion?: string
}

export interface SaveJob {
  /** 0..1, by bytes against the estimate */
  progress: number
  cancel: () => void
}

const jobs: Record<string, SaveJob> = {}
const errors: Record<string, string> = {}
/** Books whose text has changed on the server since they were saved */
const textChanged: Record<string, boolean> = {}
/** URLs the index still lists after the browser removed their cached files. */
const missingFiles: Record<string, Set<string>> = {}

function emit() {
  window.dispatchEvent(new CustomEvent(OFFLINE_CHANGED_EVENT))
}

// Another tab saved or removed a book
window.addEventListener('storage', e => { if (e.key === SAVED_KEY) emit() })

/** Run `fn` holding the named locks in order; without Web Locks (Safari < 15.4) just run it. */
function withLocks<T>(locks: [string, LockOptions][], fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!navigator.locks || locks.length === 0) return fn()
  const [[name, options], ...rest] = locks
  return navigator.locks.request(name, { ...options, signal }, () => withLocks(rest, fn, signal)) as Promise<T>
}

export function getSavedBooks(): Record<string, SavedBook> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
      const b = value as SavedBook | null
      return b && (b.voice === null || typeof b.voice === 'string')
        && b.files && typeof b.files === 'object' && !Array.isArray(b.files)
        && Object.values(b.files).every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)
        && typeof b.savedAt === 'number' && Number.isFinite(b.savedAt)
    })) as Record<string, SavedBook>
  } catch { return {} }
}

function setSavedBook(slug: string, book: SavedBook | null) {
  const all = getSavedBooks()
  if (book) all[slug] = book
  else delete all[slug]
  // The file cache and this index are one save: a failed index write must fail
  // the download too, otherwise it leaves files the app cannot manage or use.
  localStorage.setItem(SAVED_KEY, JSON.stringify(all))
}

export function savedBytes(book: SavedBook): number {
  return Object.values(book.files).reduce((sum, n) => sum + n, 0)
}

const isTitle = (url: string) => url.endsWith('.title.m4a')

/** Narration chapters saved for this book. */
export function savedAudioChapters(book: SavedBook): number {
  return Object.keys(book.files).filter(url => url.endsWith('.m4a') && !isTitle(url)).length
}

/** The saved copy of a URL, if this device has one. */
export async function savedResponse(url: string): Promise<Response | undefined> {
  if (typeof caches === 'undefined') return undefined
  try {
    return await (await caches.open(CACHE)).match(url)
  } catch {
    return undefined
  }
}

/** Fetch a book file from the saved copy when there is one, else from the network. */
export async function fetchSavedOr(url: string): Promise<Response> {
  return (await savedResponse(url)) ?? fetch(url)
}

/** A catalogue book's chapters, from the saved copy when there is one; throws when they can't be loaded. */
export async function fetchChapters(contentPath: string): Promise<AudioChapter[]> {
  const expected = CATALOG.find(book => book.contentPath === contentPath)?.narrationRevision
  const read = async (res: Response) => {
    if (!res.ok) throw new Error(`${res.status} for ${contentPath}`)
    return await res.json() as { narrationRevision?: string; chapters: { title: string; content: string }[] }
  }
  let data = await read(await fetchSavedOr(contentPath))
  if (expected && data.narrationRevision !== expected) {
    // A saved excerpt must not meet the restored edition's new narration. Keep its
    // offline save intact for the normal Update flow; read fresh text online only.
    if (!navigator.onLine) throw new Error('Saved text is out of date. Reconnect and update this book.')
    data = await read(await fetch(contentPath, { cache: 'no-store' }))
    if (data.narrationRevision !== expected) throw new Error('The updated book text is not available yet.')
  }
  return data.chapters.map((ch, i) => ({ id: `ch-${i}`, title: ch.title, content: ch.content }))
}

/** Estimated download size of a book's narration in this voice, with its chapters' spoken titles. */
export function estimateAudioBytes(manifest: PreparedManifest, slug: string, voice: string, extras: ManifestExtras | null): number {
  const durations = manifest[voice]?.[slug] ?? []
  const seconds = durations.reduce<number>((sum, d, i) => sum + (d === null ? 0 : d + (titleSeconds(extras, slug, i, voice) ?? 0)), 0)
  return seconds * AUDIO_BYTES_PER_SECOND
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${LOCALE.number(Math.max(1, Math.round(bytes / 1024)))} KB`
  return `${LOCALE.number(bytes / (1024 * 1024), bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

const isQuotaError = (err: unknown) => err instanceof DOMException && err.name === 'QuotaExceededError'

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(id); reject(signal.reason) }, { once: true })
  })
}

/**
 * Download a book's text and every prepared chapter not saved yet. Also used
 * for "Update": only what the saved copy lacks downloads, and the text again
 * when it changed. A failed or cancelled first save leaves nothing behind; a
 * failed update keeps the files it finished. Each file is tried ATTEMPTS times.
 * `voice` null: the text only (updating a book saved for reading).
 */
export function saveBook(slug: string, voice: string | null) {
  const book = CATALOG.find(b => b.id === slug)
  if (!book || jobs[slug]) return
  const controller = new AbortController()
  const job: SaveJob = { progress: 0, cancel: () => controller.abort() }
  jobs[slug] = job
  delete errors[slug]
  emit()
  // Ask the browser not to evict saved books (still inside the click); My books shows the answer
  navigator.storage?.persist?.().then(emit, () => {})

  const signal = controller.signal
  const textUrl = new URL(book.contentPath, location.href).href

  async function run() {
    // Read under the lock: another tab may have saved this book meanwhile
    const previous = getSavedBooks()[slug]
    const files: Record<string, number> = { ...previous?.files }
    let textVersion = previous?.textVersion
    let cache: Cache
    let done = 0
    let total = 1

    /** Download `url` into the saved copy; false when an optional file can't be had. */
    async function store(url: string, required: boolean, init?: RequestInit): Promise<Response | false> {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(url, { ...init, signal })
          if (res.status === 304) return res
          if (!res.ok) {
            if (!required && res.status === 404) return false
            throw new Error(`${res.status} for ${url}`)
          }
          const blob = await res.blob()
          await cache.put(url, new Response(blob, { headers: { 'content-type': blob.type } }))
          files[url] = blob.size
          done += blob.size
          job.progress = Math.min(0.99, done / total)
          emit()
          return res
        } catch (err) {
          if (signal.aborted || isQuotaError(err)) throw err
          if (attempt >= ATTEMPTS) {
            if (required) throw err
            return false
          }
          await wait(1000 * attempt, signal)
        }
      }
    }

    try {
      cache = await caches.open(CACHE)
      // Browser storage can be evicted independently of the index. Never skip
      // a file just because its URL is still recorded in localStorage.
      for (const url of Object.keys(files)) if (!await cache.match(url)) delete files[url]
      // Text-only saves do not depend on the availability of the audio host.
      const manifestRes = voice ? await fetch(MANIFEST_URL, { signal }) : null
      if (manifestRes && !manifestRes.ok) throw new Error(`Narration manifest: ${manifestRes.status}`)
      const { manifest, extras } = parseManifest(manifestRes ? await manifestRes.clone().json() : {})
      const durations = (voice && manifest[voice]?.[slug]) || []
      const narrated = durations.some(d => d != null)
      total = (voice && estimateAudioBytes(manifest, slug, voice, extras)) || 1

      // The text again only when it changed on the server (304 otherwise)
      const text = await store(textUrl, true, files[textUrl] && textVersion
        ? { headers: { 'if-none-match': textVersion } }
        : { cache: 'no-cache' })
      if (text && text.status !== 304) textVersion = text.headers.get('etag') ?? undefined
      // The service worker keeps covers in its own runtime cache (book-covers-v1, never evicted
      // at catalogue size), so fetching it once is enough for it to show offline (books#8)
      const cover = coverUrl(slug)
      if (cover) await fetch(cover, { signal }).catch(() => {})
      if (narrated && manifestRes) await cache.put(MANIFEST_URL, manifestRes)
      for (let i = 0; i < durations.length; i++) {
        if (durations[i] == null) continue
        const audio = preparedUrl(slug, i, voice!)
        if (files[audio]) done += files[audio]
        else await store(audio, true)
        // Word timings and the spoken title sit next to each chapter, and may be published after it
        const timings = preparedTimingsUrl(slug, i, voice!)
        if (!files[timings] && hasTimings(extras, slug, voice!)) await store(timings, false)
        const title = preparedTitleUrl(slug, i, voice!)
        if (files[title]) done += files[title]
        else if (titleSeconds(extras, slug, i, voice!) !== null) await store(title, false)
      }
      setSavedBook(slug, { voice: narrated ? voice : null, files, savedAt: Date.now(), format: SAVE_FORMAT, textVersion })
      delete textChanged[slug]
      delete missingFiles[slug]
    } catch (err) {
      if (!signal.aborted) {
        errors[slug] = isQuotaError(err)
          ? t('save.errorSpace')
          : t('save.errorDownload')
      }
      if (previous) {
        // An interrupted update keeps what it finished downloading
        try { setSavedBook(slug, { ...previous, files }) } catch {
          // If the index itself cannot be written, preserve its previous save
          // and remove only the files the failed update added.
          await removeFiles(Object.keys(files).filter(url => !(url in previous.files))).catch(() => {})
        }
      } else {
        await removeFiles(Object.keys(files)).catch(() => {})
      }
    }
  }

  withLocks([[FILES_LOCK, { mode: 'shared' }], [bookLock(slug), {}]], run, signal)
    .catch(() => {}) // cancelled while another tab was saving it
    .finally(() => {
      delete jobs[slug]
      emit()
    })
}

async function removeFiles(urls: string[]) {
  const cache = await caches.open(CACHE)
  await Promise.all(urls.map(url => cache.delete(url)))
  // A failed update can still have its original narrated save in the index.
  if (!Object.values(getSavedBooks()).some(b => b.voice)) await cache.delete(MANIFEST_URL)
}

/**
 * Remove a saved book. A chapter playing from it plays on (its audio is
 * already in memory); later chapters stream, and offline aren't offered.
 */
export function removeSavedBook(slug: string): Promise<void> {
  delete errors[slug]
  delete textChanged[slug]
  delete missingFiles[slug]
  return withLocks([[FILES_LOCK, { mode: 'shared' }], [bookLock(slug), {}]], async () => {
    const saved = getSavedBooks()[slug]
    if (!saved) return
    setSavedBook(slug, null)
    await removeFiles(Object.keys(saved.files))
  }).catch(() => {
    errors[slug] = t('save.errorRemove')
  }).finally(emit)
}

// A book is written to the index only once its save completes. Clear the files of
// saves whose page closed mid-download, while no tab is saving.
if (typeof caches !== 'undefined' && navigator.locks) {
  navigator.locks.request(FILES_LOCK, { ifAvailable: true }, async lock => {
    if (!lock) return
    const books = Object.values(getSavedBooks())
    const keep = new Set(books.flatMap(b => Object.keys(b.files)))
    if (books.some(b => b.voice)) keep.add(MANIFEST_URL)
    const cache = await caches.open(CACHE)
    const requests = await cache.keys()
    const available = new Set(requests.map(req => req.url))
    for (const [slug, book] of Object.entries(getSavedBooks())) {
      const missing = Object.keys(book.files).filter(url => !available.has(url))
      if (missing.length) missingFiles[slug] = new Set(missing)
    }
    for (const req of requests) if (!keep.has(req.url)) await cache.delete(req)
    if (Object.keys(missingFiles).length) emit()
  }).catch(() => {})
}

const textChecks = new Set<string>()

/** Find out (once per session) whether a saved book's text has changed on the server. */
export function checkSavedText(slug: string) {
  const saved = getSavedBooks()[slug]
  const book = CATALOG.find(b => b.id === slug)
  if (!saved?.textVersion || !book || textChecks.has(slug) || !navigator.onLine) return
  textChecks.add(slug)
  fetch(book.contentPath, { method: 'HEAD', cache: 'no-cache' })
    .then(res => {
      const etag = res.headers.get('etag')
      if (res.ok && etag && etag !== getSavedBooks()[slug]?.textVersion) {
        textChanged[slug] = true
        emit()
      }
    })
    .catch(() => textChecks.delete(slug))
}

/** What Update would bring to a saved book, in words, or null when it is up to date. */
export function updateReason(slug: string, book: SavedBook, manifest: PreparedManifest): string | null {
  if (missingFiles[slug]?.size) return t('update.missing')
  const newChapters = book.voice ? preparedCount(manifest, slug, book.voice) - savedAudioChapters(book) : 0
  if (newChapters > 0) return t('update.newChapters', { count: newChapters })
  if (textChanged[slug]) return t('update.text')
  const voice = book.voice
  if (voice && (manifest[voice]?.[slug] ?? []).some((d, i) => d !== null
    && titleSeconds(getManifestExtras(), slug, i, voice) !== null && !(preparedTitleUrl(slug, i, voice) in book.files))) return t('update.titles')
  if ((book.format ?? 1) < SAVE_FORMAT) return t(book.voice ? 'update.readAlong' : 'update.latestText')
  return null
}

/**
 * The narration that can be played now. Offline that is only the chapters
 * saved on this device, though the manifest (loaded earlier, or the saved
 * copy) lists every narrated book (books#24).
 */
export function playableManifest(manifest: PreparedManifest, online = navigator.onLine): PreparedManifest {
  if (online) return manifest
  const saved = getSavedBooks()
  const playable: PreparedManifest = {}
  for (const [voice, books] of Object.entries(manifest)) {
    playable[voice] = {}
    for (const [slug, durations] of Object.entries(books)) {
      const files = saved[slug]?.files
      if (files) playable[voice][slug] = durations.map((d, i) => {
        const url = preparedUrl(slug, i, voice)
        return url in files && !missingFiles[slug]?.has(url) ? d : null
      })
    }
  }
  return playable
}

export interface OfflineState {
  saved: Record<string, SavedBook>
  jobs: Record<string, SaveJob>
  errors: Record<string, string>
}

export function useOfflineBooks(): OfflineState {
  const read = () => ({ saved: getSavedBooks(), jobs: { ...jobs }, errors: { ...errors } })
  const [state, setState] = useState(read)
  useEffect(() => {
    const sync = () => setState(read())
    window.addEventListener(OFFLINE_CHANGED_EVENT, sync)
    return () => window.removeEventListener(OFFLINE_CHANGED_EVENT, sync)
  }, [])
  return state
}

/** usePreparedManifest narrowed to what can be played now; follows the connection and saves. */
export function usePlayableManifest(): PreparedManifest | null {
  const manifest = usePreparedManifest()
  const online = useOnline()
  const { saved } = useOfflineBooks()
  return useMemo(() => manifest && playableManifest(manifest, online), [manifest, online, saved])
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  return online
}
