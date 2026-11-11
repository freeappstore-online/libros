import { useState } from 'react'
import type { CatalogBook } from '../data/book'
import { COVERS } from '../data/covers'
import { t } from '../locales'

interface Props {
  book: CatalogBook
  size?: 'sm' | 'md' | 'lg'
}

const sizes = {
  sm: { w: 'w-20 sm:w-28', h: 'h-28 sm:h-40', title: 'text-xs', author: 'text-[10px]' },
  md: { w: 'w-36', h: 'h-52', title: 'text-sm', author: 'text-xs' },
  // Grid covers: shrink to the column on phones (a fixed 12rem overlapped the next one)
  lg: { w: 'w-full max-w-48', h: 'aspect-[12/17]', title: 'text-base', author: 'text-sm' },
}

/** The book's self-hosted Gutenberg cover, or null if it has none. The service worker
 *  runtime-caches /covers/ (vite.config.ts), so fetching this URL while online keeps it offline. */
export function coverUrl(id: string): string | null {
  return COVERS.has(id) ? `/covers/${id}.webp` : null
}

export function BookCover({ book, size = 'md' }: Props) {
  const s = sizes[size]
  const [failed, setFailed] = useState(false)
  const src = failed ? null : coverUrl(book.id)
  return (
    <div className={`${s.w} ${s.h} rounded-lg bg-gradient-to-br ${book.coverGradient} relative overflow-hidden flex flex-col justify-end p-3 shadow-lg group-hover:shadow-xl transition-shadow`}>
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 20px, ${book.coverAccent}22 20px, ${book.coverAccent}22 21px)`,
      }} />
      <div className="relative z-10">
        <h3 className={`${s.title} font-display leading-tight text-white mb-1`}>{book.title}</h3>
        <p className={`${s.author} text-white/60`}>{book.author}</p>
      </div>
      <div className="absolute top-2 right-2 w-6 h-6 rounded-full opacity-20" style={{ background: book.coverAccent }} />
      {src && (
        <img
          src={src}
          alt={t('cover.alt', { title: book.title, author: book.author })}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 z-20 w-full h-full object-cover"
        />
      )}
    </div>
  )
}
