import { useNavigate } from 'react-router-dom'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { primeNarration } from '../hooks/narration'
import { fetchChapters } from '../hooks/offlineBooks'
import { readPath, type CatalogBook } from '../data/book'
import { t } from '../locales'

/** Resume listening to a book where it stopped, and open it in the reader (books#13). */
export function ListenButton({ book, className }: { book: CatalogBook; className?: string }) {
  const player = useAudioPlayer()
  const navigate = useNavigate()

  const listen = async () => {
    // Synchronously, while this is still the user's click (iOS)
    primeNarration()
    try {
      const chapters = await fetchChapters(book.contentPath)
      player.loadAndPlay({ slug: book.id, title: book.title, author: book.author, chapters })
    } catch { /* Opens the reader anyway, which explains what is missing */ }
    navigate(readPath(book.id))
  }

  return (
    <button onClick={listen} className={className}>
      {t('player.listen')}
    </button>
  )
}
