// The interface in Spanish (books#54): with an edition whose language is "es" (test/edition-es), the
// catalogue, reader, player, My books and Settings show no English, in their menus, dialogs, labels
// and offline messages too, and axe finds nothing. Runs as the `es` project, against its own build.
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, stubHuggingFace, axeViolations, bar, SLUG } from '../fixtures'

const json = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T
type Locale = Record<string, string | Record<string, string>>
const messages = (locale: Locale) => Object.values(locale).flatMap(m => (typeof m === 'string' ? [m] : Object.values(m)))
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Any case: innerText is as shown, and headings are uppercased by CSS
const asWord = (s: string) => new RegExp(`(?<!\\p{L})${escape(s)}(?!\\p{L})`, 'iu')
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The English interface's words: en.json's messages, cut at their placeholders, that Spanish doesn't use too */
const spanish = messages(json<Locale>('../../src/locales/es.json')).join('\n')
const ENGLISH = [...new Set(messages(json<Locale>('../../src/locales/en.json'))
  .flatMap(m => m.split(/\{\w+\}/)).map(s => s.trim()).filter(s => /\p{L}{3,}/u.test(s)))]
  .filter(s => !asWord(s).test(spanish))
  .map(s => [s, asWord(s)] as const)

/** The books' own words stay as their edition wrote them (English here): their metadata and texts */
type Book = { id: string; title: string; author: string; authorBio: string; description: string; excerpt: string; tags: string[] }
const BOOKS = json<Book[]>('../../test/edition-es/books.json')
const chapters = BOOKS.flatMap(b => json<{ chapters: { title: string; content: string }[] }>(`../../test/edition-es/texts/${b.id}.json`).chapters)
const BOOK_STRINGS = [...BOOKS.flatMap(b => [b.title, b.author, b.authorBio, b.description, b.excerpt, ...b.tags]), ...chapters.map(c => c.title)]
  .filter(Boolean).sort((a, b) => b.length - a.length)
const BOOK_TEXT = squash(chapters.map(c => `${c.title}\n${c.content}`).join('\n'))

/** English left in what the page shows or names (text, labels, titles, options), book text aside */
async function english(page: Page): Promise<string[]> {
  const shown = await page.evaluate(() => {
    // The chapter text is the book's: hidden while reading the page's text
    const style = document.head.appendChild(document.createElement('style'))
    style.textContent = '[data-chapter-text] { display: none !important }'
    const out = document.body.innerText.split('\n')
    style.remove()
    for (const el of document.querySelectorAll('[aria-label], [title], [placeholder], [alt], [aria-valuetext]')) {
      if (!el.checkVisibility()) continue
      for (const name of ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext']) out.push(el.getAttribute(name) ?? '')
    }
    for (const option of document.querySelectorAll('option')) out.push(option.textContent ?? '')
    out.push(document.title)
    return out
  })
  return shown.flatMap(raw => {
    let text = raw
    for (const s of BOOK_STRINGS) text = text.replaceAll(s, ' ')
    text = squash(text)
    // Bookmarks and search results quote the book, cut with …
    if (!text || BOOK_TEXT.includes(text.replace(/^…|…$/g, ''))) return []
    return ENGLISH.filter(([, word]) => word.test(text)).map(([s]) => `${s} in ${JSON.stringify(squash(raw))}`)
  })
}

test('an edition in Spanish shows no English, and axe finds nothing', async ({ page, context, baseURL }) => {
  test.setTimeout(120_000)
  const hf = await stubHuggingFace(context, baseURL!)
  const check = async (where: string, { axe = true } = {}) => {
    await page.waitForLoadState('networkidle')
    expect(await english(page), where).toEqual([])
    if (axe) expect(await axeViolations(page), where).toEqual([])
  }

  // Catalogue
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { name: 'Audiolibros', exact: true })).toBeVisible()
  await check('catálogo')
  await page.getByRole('button', { name: 'Audiolibros', exact: true }).click()
  await expect(page.getByRole('heading', { name: '1 audiolibro', exact: true })).toBeVisible()
  await page.getByLabel('Buscar libros').fill('ninguno')
  await expect(page.getByText('Ningún libro coincide con tu búsqueda.')).toBeVisible()
  await check('catálogo sin resultados')

  // Reader and player, playing
  await page.goto(`/read/${SLUG}`)
  await page.locator('header').getByRole('button', { name: 'Reproducir', exact: true }).click()
  await page.waitForSelector('[data-readalong="word"]')
  await check('lector reproduciendo')
  await bar(page).getByRole('button', { name: 'Mostrar capítulos' }).click()
  await page.getByRole('button', { name: /^Recientes/ }).click()
  await check('reproductor: recientes')
  await page.locator('#player-panel').getByRole('button', { name: 'Escucha', exact: true }).click()
  await check('reproductor: escucha')
  await page.getByRole('button', { name: 'Temporizador de apagado' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await check('temporizador')
  await page.keyboard.press('Escape')
  await bar(page).getByRole('button', { name: /^Velocidad/ }).click({ button: 'right' })
  await expect(page.getByRole('menu', { name: 'Velocidad' })).toBeVisible()
  await check('velocidad')
  await page.keyboard.press('Escape')

  // Bookmarks, search, text size and the shortcuts
  await page.getByRole('button', { name: 'Marcadores y notas' }).click()
  await check('marcadores vacíos')
  await page.getByRole('button', { name: 'Marcar este lugar' }).click()
  await expect(page.getByRole('button', { name: 'Agregar nota' })).toBeVisible()
  await check('marcadores')
  await page.getByRole('button', { name: 'Buscar en este libro' }).click()
  await page.keyboard.type('rabbit')
  await expect(page.getByText(/resultados en \d+ capítulos/)).toBeVisible()
  await check('búsqueda')
  await page.getByRole('button', { name: 'Cerrar la búsqueda' }).click()
  await page.getByRole('button', { name: 'Tamaño del texto' }).click()
  await check('tamaño del texto')
  await page.keyboard.press('Escape')
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Atajos de teclado' })).toBeVisible()
  await check('atajos')
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()

  // A reading-only book, saved for offline
  await page.goto('/read/a-christmas-carol')
  await page.getByRole('button', { name: '↓ Guardar para leer sin conexión' }).click()
  await expect(page.getByText('✓ Guardado sin conexión')).toBeVisible()
  await check('libro guardado')

  // My books and Settings
  await page.goto('/library')
  await expect(page.getByRole('heading', { name: 'Guardados en este dispositivo' })).toBeVisible()
  await page.locator('summary').first().click()
  await check('mis libros')
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Escucha' })).toBeVisible()
  await check('ajustes')

  // Offline: the catalogue, and a book that isn't saved
  await page.goto('/')
  hf.offline = true
  await context.setOffline(true)
  await expect(page.getByText('Sin conexión', { exact: true })).toBeVisible()
  // axe runs online, as a11y.spec.ts: offline, books not saved are dimmed below contrast on purpose
  await check('catálogo sin conexión', { axe: false })
  await page.getByRole('link', { name: /Alice's Adventures in Wonderland/ }).first().click()
  await expect(page.getByText(/Estás sin conexión y este libro no está guardado/)).toBeVisible()
  await check('lector sin conexión', { axe: false })
})
