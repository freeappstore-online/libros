/**
 * A static page per book, written at build time (books#47), so search engines
 * see each book's title, description and opening without running the app. Each
 * page is the built index.html with the book's metadata and content in #root,
 * which the app replaces when it starts.
 */
import { readPath, type CatalogBook } from '../data/book'
import type { EditionConfig } from '../data/edition'
import type { Locale } from '../locales/locale'

/** What a page takes from the edition (edition/config.json) */
export type PageEdition = Pick<EditionConfig, 'site' | 'name' | 'language'>

export interface BookPageContent {
  chapterTitles: string[]
  /** Paragraphs from the start of the book */
  opening: string[]
  /** Chapters with narration (0: reading only) */
  narrated: number
  hasCover: boolean
}

const OPENING_CHARS = 1500

/** The first paragraphs of the text, about OPENING_CHARS long. */
export function openingParagraphs(text: string): string[] {
  const out: string[] = []
  let length = 0
  for (const paragraph of text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)) {
    out.push(paragraph)
    length += paragraph.length
    if (length >= OPENING_CHARS) break
  }
  return out
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Replaces a tag of the shell, failing the build if index.html no longer has it. */
function replaceOnce(html: string, pattern: RegExp, replacement: string): string {
  if (!pattern.test(html)) throw new Error(`book pages: index.html has no ${pattern}`)
  return html.replace(pattern, () => replacement)
}

function setMeta(html: string, attribute: 'name' | 'property', key: string, value: string): string {
  return replaceOnce(html, new RegExp(`<meta ${attribute}="${key}" content="[^"]*"\\s*/?>`), `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`)
}

function audioNote({ t }: Locale, narrated: number, chapters: number): string {
  if (narrated === 0) return ''
  return narrated >= chapters ? t('seo.audioAll') : t('seo.audioSome', { narrated, count: chapters })
}

/** The page of `book`, in the edition's language: `locale` is its locale (the build config passes it in). */
export function bookPage(shell: string, book: CatalogBook, content: BookPageContent, edition: PageEdition, locale: Locale): string {
  const { t } = locale
  const url = edition.site + readPath(book.id)
  const listen = content.narrated > 0
  const names = { title: book.title, author: book.author, name: edition.name, description: book.description }
  const title = t(listen ? 'seo.titleListen' : 'seo.titleRead', names)
  const description = t(listen ? 'seo.descriptionListen' : 'seo.descriptionRead', names)
  const image = content.hasCover ? `${edition.site}/covers/${book.id}.webp` : undefined
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: book.title,
    author: { '@type': 'Person', name: book.author },
    ...(book.year > 0 && { datePublished: String(book.year) }),
    genre: locale.genre(book.genre),
    keywords: book.tags.join(', '),
    description: book.description,
    inLanguage: edition.language,
    url,
    ...(image && { image }),
    isAccessibleForFree: true,
  }

  let html = replaceOnce(shell, /<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
  html = setMeta(html, 'name', 'description', description)
  html = setMeta(html, 'property', 'og:title', title)
  html = setMeta(html, 'property', 'og:description', description)
  html = setMeta(html, 'property', 'og:url', url)
  html = setMeta(html, 'property', 'og:type', 'book')
  html = setMeta(html, 'name', 'twitter:title', title)
  html = setMeta(html, 'name', 'twitter:description', description)
  html = replaceOnce(html, /<\/head>/, [
    `<link rel="canonical" href="${url}" />`,
    image ? `<meta property="og:image" content="${image}" />` : '',
    // "<" escaped so the book text can't end the script element
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
    '</head>',
  ].filter(Boolean).join('\n'))

  const note = audioNote(locale, content.narrated, book.chapters)
  const main = `<main class="min-h-dvh bg-page text-text">
<article class="max-w-2xl mx-auto px-5 py-10 space-y-6">
<header class="space-y-2">
<h1 class="text-3xl font-bold">${escapeHtml(book.title)}</h1>
<p class="text-text-muted">${[book.author, locale.year(book.year), locale.genre(book.genre), t('seo.chapters', { count: book.chapters }), locale.readTime(book.readMinutes)].map(escapeHtml).join(' &middot; ')}</p>
</header>
<p>${escapeHtml(book.description)}</p>
${note ? `<p>${escapeHtml(note)}</p>\n` : ''}<p><a href="${readPath(book.id)}" class="text-accent">${escapeHtml(t(listen ? 'seo.ctaListen' : 'seo.ctaRead'))}</a></p>
<section class="space-y-3">
<h2 class="text-xl font-semibold">${escapeHtml(t('seo.opening'))}</h2>
${content.opening.map(p => `<p>${escapeHtml(p)}</p>`).join('\n')}
</section>
<section class="space-y-2">
<h2 class="text-xl font-semibold">${escapeHtml(t('chapters.title'))}</h2>
<ol class="list-decimal pl-6 text-text-muted">
${content.chapterTitles.map(t => `<li>${escapeHtml(t)}</li>`).join('\n')}
</ol>
</section>
<section class="space-y-2">
<h2 class="text-xl font-semibold">${escapeHtml(t('seo.about', { author: book.author }))}</h2>
<p>${escapeHtml(book.authorBio)}</p>
</section>
<p><a href="/" class="text-accent">${escapeHtml(t('seo.browse'))}</a></p>
</article>
</main>`
  return replaceOnce(html, /<div id="root"><\/div>/, `<div id="root">${main}</div>`)
}

export function sitemap(slugs: string[], site: string): string {
  const urls = ['/', ...slugs.map(readPath)].map(path => `  <url><loc>${site}${path}</loc></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}
