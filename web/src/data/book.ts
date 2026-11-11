// What the app knows about a book, and its addresses. Free of the edition's data, so the build
// config can use it (vite.config.ts reads the edition itself, see docs/editions.md).

export interface CatalogBook {
  id: string
  title: string
  author: string
  authorBio: string
  year: number
  /** One of the fixed keys Fiction, Non-Fiction, Drama, Poetry; the locale has its label */
  genre: string
  tags: string[]
  /** BCP 47 language of the text, e.g. 'en' */
  language: string
  description: string
  excerpt: string
  chapters: number
  /** Reading time in minutes, a multiple of 15; the locale writes it (books#54) */
  readMinutes: number
  coverGradient: string
  coverAccent: string
  contentPath: string
  /** Revised texts use a separate narration folder and matching manifest revision. */
  narrationRevision?: string
}

/** A book's address. Ends in "/" so the host serves its static page, read/<slug>/index.html (books#47). */
export function readPath(slug: string): string {
  return `/read/${slug}/`
}
