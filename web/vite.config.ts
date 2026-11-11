import { cpSync, createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from '@freeappstore/sdk/pwa-config'
import type { CatalogBook } from './src/data/book'
import type { EditionConfig } from './src/data/edition'
import { datasetBase, narratedCount, parseManifestFor } from './src/hooks/manifest'
import { bookPage, openingParagraphs, sitemap } from './src/seo/bookPages'
import { makeLocale, type Messages } from './src/locales/locale'

// This app's edition: its config, books, texts and covers (docs/editions.md). BOOKS_EDITION points
// the build at another one. The config reads it from disk: app code reaches it as @edition/*.
const editionDir = resolve(process.env.BOOKS_EDITION || fileURLToPath(new URL('../edition', import.meta.url)))
const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(editionDir, file), 'utf8')) as T
const EDITION = readJson<EditionConfig>('config.json')
const CATALOG = readJson<CatalogBook[]>('books.json')
const COVERS = new Set(readJson<string[]>('covers.json'))
// The interface language is the edition's (books#54): the static pages are written in it too
const localeFile = fileURLToPath(new URL(`./src/locales/${EDITION.language}.json`, import.meta.url))
if (!existsSync(localeFile)) throw new Error(`No locale for the edition's language ${EDITION.language}: add src/locales/${EDITION.language}.json`)
const LOCALE = makeLocale(JSON.parse(readFileSync(localeFile, 'utf8')) as Messages, EDITION.language)

// Book covers (/covers/*.webp) stay out of the precache; they are cached as they are shown.
// maxEntries is above the catalogue size so a cover fetched for an offline book is never evicted.
const coverCache = {
  urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/covers/'),
  handler: 'CacheFirst' as const,
  options: { cacheName: 'book-covers-v1', expiration: { maxEntries: 300 } },
}

// Plain strings, not regex literals: the platform's compliance check reads a quote in a regex as a string
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/**
 * The PWA manifest, named for the edition. public/manifest.json stays the source (the platform's
 * compliance check reads it); its name, short_name and lang come from the edition.
 */
function webManifest(): string {
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8')) as Record<string, unknown>
  return JSON.stringify({ ...manifest, name: EDITION.name, short_name: EDITION.shortName, lang: EDITION.language }, null, 2) + '\n'
}

/**
 * The edition in the app: its strings and its locale's in index.html ({{edition.title}},
 * {{locale.meta.ogLocale}}), its PWA manifest, and its texts and covers
 * served at /catalog/ and /covers/ (the URLs saved books and narration positions are keyed by),
 * and its own files at the site root (edition/public/).
 */
function edition(): Plugin {
  const files = (url: string) => {
    const [, dir, name] = url.split('?')[0].match(/^\/(catalog|covers)\/([\w.-]+)$/) ?? []
    const file = dir && join(editionDir, dir === 'catalog' ? 'texts' : 'covers', name)
    return file && existsSync(file) ? file : null
  }
  return {
    name: 'edition',
    config: () => ({ resolve: { alias: { '@edition': editionDir } } }),
    transformIndexHtml: {
      order: 'pre',
      handler: html => html
        .replace(/\{\{edition\.(\w+)\}\}/g, (_, key: string) => {
          const value = EDITION[key as keyof EditionConfig]
          if (typeof value !== 'string') throw new Error(`index.html: no string ${key} in edition/config.json`)
          return escapeHtml(value)
        })
        .replace(/\{\{locale\.([\w.]+)\}\}/g, (_, key: string) => escapeHtml(LOCALE.t(key as keyof Messages))),
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/manifest.json') {
          res.setHeader('content-type', 'application/manifest+json')
          return res.end(webManifest())
        }
        const file = files(req.url ?? '')
        if (!file) return next()
        res.setHeader('content-type', file.endsWith('.json') ? 'application/json' : 'image/webp')
        createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      const out = options.dir!
      // After the public folder's copy (renderStart), so the edition's manifest replaces it
      writeFileSync(join(out, 'manifest.json'), webManifest())
      cpSync(join(editionDir, 'texts'), join(out, 'catalog'), { recursive: true })
      if (existsSync(join(editionDir, 'covers'))) cpSync(join(editionDir, 'covers'), join(out, 'covers'), { recursive: true })
      // The edition's own files at the site root (search engine verification, IndexNow key)
      if (existsSync(join(editionDir, 'public'))) cpSync(join(editionDir, 'public'), out, { recursive: true })
    },
  }
}

/** A static page per book, read/<slug>/index.html, and a sitemap listing them (books#47). */
function bookPages(): Plugin {
  return {
    name: 'book-pages',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_, bundle) {
      const shell = bundle['index.html']
      if (shell?.type !== 'asset') throw new Error('book pages: no index.html in the build')
      // Unreachable narration server: the pages just leave out the audiobook line
      const { manifest } = parseManifestFor(await fetch(`${datasetBase(EDITION.audio.dataset)}/manifest.json`, { signal: AbortSignal.timeout(20_000) })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch(e => { this.warn(`narration manifest: ${e}`); return {} }), CATALOG)
      for (const book of CATALOG) {
        const { chapters } = JSON.parse(readFileSync(join(editionDir, 'texts', `${book.id}.json`), 'utf8')) as { chapters: { title: string; content: string }[] }
        this.emitFile({
          type: 'asset',
          fileName: `read/${book.id}/index.html`,
          source: bookPage(String(shell.source), book, {
            chapterTitles: chapters.map(c => c.title),
            opening: openingParagraphs(chapters[0].content),
            narrated: narratedCount(manifest, book.id, EDITION.audio.voice),
            hasCover: COVERS.has(book.id),
          }, EDITION, LOCALE),
        })
      }
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(CATALOG.map(b => b.id), EDITION.site) })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), edition(), bookPages(), VitePWA(pwaOptions({
    workbox: {
      // The book pages are for search engines; the installed app opens books from the shell
      globIgnores: ['read/**'],
      // silence.wav primes the narration <audio> on iOS and is the pause between chapters; it must load offline too (books#7, #37)
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wav}'],
      runtimeCaching: [...(pwaOptions().workbox.runtimeCaching ?? []), coverCache],
    },
  }))],
  server: { host: true },
})
