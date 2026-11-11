import { useAudioPlayer, type AudioBook } from '../hooks/useAudioPlayer'
import { chapterSeconds, isNarrated, usePreparedManifest } from '../hooks/preparedAudio'
import { usePlayableManifest } from '../hooks/offlineBooks'
import { t } from '../locales'

/** The one way to listen: plays the narration of the chapter on screen. */
export function PlayButton({ book, chapterIdx }: { book: AudioBook; chapterIdx: number }) {
  const player = useAudioPlayer()
  // Offline, only books saved on this device (books#24)
  const manifest = usePlayableManifest()
  const full = usePreparedManifest()
  const isPlaying = player.book?.slug === book.slug && player.playing

  // Books without narration are reading-only, and so are the chapters without it of a partly
  // narrated book (books#31); nothing shows until the manifest says which. A narrated chapter not
  // saved offline keeps Play, which explains why it can't play.
  if (!isPlaying && (!manifest || !full || !isNarrated(manifest, book.slug) || chapterSeconds(full, book.slug, chapterIdx) === null)) return null

  return (
    <button
      onClick={() => (isPlaying ? player.pause() : player.loadAndPlay(book, chapterIdx))}
      data-shortcut="play"
      aria-keyshortcuts="Space K"
      className="min-h-10 px-4 py-1.5 rounded-lg font-semibold text-sm bg-accent hover:bg-accent-hover text-btn-text transition"
    >
      {t(isPlaying ? 'player.pause' : 'player.play')}
    </button>
  )
}
