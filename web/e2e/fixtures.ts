/**
 * Shared setup for the e2e tests (books#16): Hugging Face stubbed with silent
 * WAVs made here and generated timings, plus page helpers.
 */
import { test as base, expect, type BrowserContext, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

export { expect }

export const HF = 'https://huggingface.co/datasets/serge-ivo/books-audio/resolve/main/'
export const SLUG = 'alice-in-wonderland'
export const alice = JSON.parse(readFileSync(new URL('../test/edition/texts/alice-in-wonderland.json', import.meta.url), 'utf8')) as {
  chapters: { title: string; content: string }[]
}
export const chapterUrl = (idx: number) => `${HF}af_heart/${SLUG}/${idx}.m4a`

/**
 * A partly narrated book without timings, as the books published in books#31: chapters 1, 2 (3 s)
 * and 18 narrated, 3–17 not.
 */
export const PARTIAL = 'manhattan-transfer'
export const partial = JSON.parse(readFileSync(new URL(`../test/edition/texts/${PARTIAL}.json`, import.meta.url), 'utf8')) as typeof alice
export const PARTIAL_DURATIONS: (number | null)[] = partial.chapters.map((_, i) => (i === 0 || i === partial.chapters.length - 1 ? 300 : i === 1 ? 3 : null))

/** Silent 8 kHz 8-bit mono WAV of `seconds`; with `tone`, a quiet 500 Hz square wave instead. */
export function wav(seconds: number, tone = false): Buffer {
  const n = Math.round(seconds * 8000)
  const b = Buffer.alloc(44 + n, 128)
  if (tone) for (let i = 0; i < n; i++) b[44 + i] = i % 16 < 8 ? 112 : 144
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28)
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40)
  return b
}

const LONG_SECONDS = 300
const SHORT_SECONDS = 3
const wavs = new Map<string, Buffer>()
/** The audio served for `seconds` of narration (made once) */
const wavOf = (seconds: number, tone = false) => {
  const key = `${seconds}${tone}`
  if (!wavs.has(key)) wavs.set(key, wav(seconds, tone))
  return wavs.get(key)!
}

/** Chapter 2 is 3 s long (auto-advance, sleep at end of chapter); the others 300 s. */
export const SHORT_CH = 1
export const DURATIONS: (number | null)[] = alice.chapters.map((_, i) => (i === SHORT_CH ? SHORT_SECONDS : LONG_SECONDS))

/** Same rules as readAlong.ts sentenceRanges. */
function sentenceRanges(text: string): [number, number][] {
  const r: [number, number][] = []
  let start = 0
  const push = (end: number) => {
    while (start < end && /\s/.test(text[start])) start++
    if (start < end) r.push([start, end])
    start = end
  }
  for (const m of text.matchAll(/[.!?…]+["'”’»)\]]*(?=\s)(?![^\S\n]+(?:[—–-]+[^\S\n]?)?\p{Ll})|\n/gu)) push(m.index + m[0].length)
  push(text.length)
  return r
}

/** Timings in the published shape, one second per 60 chars (every chapter fits in 300 s). */
export function timings(text: string): [number, number, number, number][] {
  let t = 0
  return sentenceRanges(text).map(([a, b]) => {
    const s: [number, number, number, number] = [a, b, t, t + (b - a) / 60]
    t = s[3]
    return s
  })
}

/** What a saved chapter holds: 20 s, small enough to save twelve of quickly */
const SMALL_WAV = wav(20)

export interface HfOptions {
  /** Narrated seconds per chapter; null = no narration */
  durations?: (number | null)[]
  /** Serve chapter audio inline (saving offline stores the response body) */
  inline?: boolean
  /** Delay before answering chapter audio and timings, to widen races */
  delayMs?: number
  /** Chapter index → how many of its audio requests fail before one succeeds (Infinity: all) */
  fail?: Record<number, number>
  /** Chapters whose timings aren't published */
  noTimings?: Set<number>
  /** Redirect chapter audio here instead (Chromium only: a streaming test server) */
  audioUrl?: string
  /** Also publish PARTIAL (PARTIAL_DURATIONS, no timings) */
  partial?: boolean
  /**
   * The manifest's "extras" (books#37), by slug: which books have timings and their
   * chapters' spoken titles (seconds), served as `<i>.title.m4a`. The manifest then
   * also carries a top-level key the app doesn't know.
   */
  extras?: Record<string, { timings?: boolean; titles?: (number | null)[] }>
  /** Chapter audio is a tone, not silence (to hear it through Web Audio) */
  tone?: boolean
}

export interface HfStub {
  /** Paths requested from Hugging Face, after the dataset root */
  requests: string[]
  /** Fail every request, as without a network */
  offline: boolean
  /** The options, read on every request: change them to change what is served */
  opts: HfOptions
}

/** Answer a media request with the part of `body` it asks for, so the audio can seek. */
function fulfillRange(route: Route, body: Buffer) {
  const headers = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-type': 'audio/wav' }
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '')
  if (!range) return route.fulfill({ headers, body })
  const start = +range[1]
  const end = Math.min(range[2] ? +range[2] : body.length - 1, body.length - 1)
  return route.fulfill({
    status: 206,
    headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` },
    body: body.subarray(start, end + 1),
  })
}

/** Answer Hugging Face requests of this context from local files. */
export async function stubHuggingFace(context: BrowserContext, baseURL: string, opts: HfOptions = {}): Promise<HfStub> {
  const stub: HfStub = { requests: [], offline: false, opts }
  const cors = { 'access-control-allow-origin': '*' }
  // Nothing else leaves the machine (analytics, fonts): the tests stay deterministic
  // (blob: URLs pass through routing in WebKit; they are local)
  await context.route(url => url.protocol.startsWith('http') && !url.href.startsWith(baseURL) && !url.href.startsWith(HF), route => route.abort())
  await context.route(HF + '**', async route => {
    const o = stub.opts
    const durations = o.durations ?? DURATIONS
    const path = route.request().url().slice(HF.length)
    stub.requests.push(path)
    if (stub.offline) return route.abort('internetdisconnected')
    if (path === 'manifest.json') {
      const books = { [SLUG]: durations, ...(o.partial && { [PARTIAL]: PARTIAL_DURATIONS }) }
      const extras = o.extras && { extras: { af_heart: o.extras }, generated: { by: 'a later pipeline' } }
      return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ af_heart: books, ...extras }) })
    }
    if (o.delayMs) await new Promise(r => setTimeout(r, o.delayMs))
    if (stub.offline) return route.abort('internetdisconnected')
    let m = /^af_heart\/alice-in-wonderland\/(\d+)\.timings\.json$/.exec(path)
    if (m && durations[+m[1]] != null && !o.noTimings?.has(+m[1])) {
      return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ v: 1, segments: timings(alice.chapters[+m[1]].content) }) })
    }
    m = /^af_heart\/([a-z-]+)\/(\d+)\.title\.m4a$/.exec(path)
    const title = m && o.extras?.[m[1]]?.titles?.[+m[2]]
    if (title) return fulfillRange(route, wavOf(title))
    m = /^af_heart\/manhattan-transfer\/(\d+)\.m4a$/.exec(path)
    if (m && o.partial && PARTIAL_DURATIONS[+m[1]] != null) {
      if (o.inline) return route.fulfill({ headers: cors, contentType: 'audio/wav', body: SMALL_WAV })
      return fulfillRange(route, wavOf(PARTIAL_DURATIONS[+m[1]]!))
    }
    m = /^af_heart\/alice-in-wonderland\/(\d+)\.m4a$/.exec(path)
    if (m && durations[+m[1]] != null) {
      const idx = +m[1]
      if (o.fail?.[idx]) {
        o.fail[idx]--
        return route.abort('connectionreset')
      }
      if (o.inline) return route.fulfill({ headers: cors, contentType: 'audio/wav', body: SMALL_WAV })
      if (o.audioUrl) return route.fulfill({ status: 302, headers: { ...cors, location: `${o.audioUrl}?${idx}` } })
      return fulfillRange(route, wavOf(durations[idx]!, o.tone))
    }
    return route.fulfill({ status: 404, headers: cors, body: '' })
  })
  return stub
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      const w = window as unknown as {
        __audios: HTMLAudioElement[]; __ms: Record<string, MediaSessionActionHandler | null>; Audio: typeof Audio
        __log: { type: string; src: string; at: number }[]; __ctxs: AudioContext[]; AudioContext: typeof AudioContext
      }
      // narration.ts creates its one element with new Audio(): keep a handle on it, and log what it plays
      const A = w.Audio
      w.__audios = []
      w.__log = []
      w.Audio = function (src?: string) {
        const a = new A(src)
        w.__audios.push(a)
        for (const type of ['playing', 'ended']) a.addEventListener(type, () => w.__log.push({ type, src: a.currentSrc || a.src, at: performance.now() }))
        return a
      } as unknown as typeof Audio
      w.Audio.prototype = A.prototype
      // The volume boost's AudioContext, if one is made
      w.__ctxs = []
      if (typeof AudioContext !== 'undefined') {
        const C = AudioContext
        w.AudioContext = class extends C { constructor(o?: AudioContextOptions) { super(o); w.__ctxs.push(this) } } as typeof AudioContext
      }
      // Lock-screen actions, to press them where the bar hides Previous/Next (phones)
      w.__ms = {}
      if (typeof MediaSession !== 'undefined') {
        // On the prototype: WebKit ignores an own property on navigator.mediaSession
        const set = MediaSession.prototype.setActionHandler
        MediaSession.prototype.setActionHandler = function (action, handler) {
          w.__ms[action] = handler
          set.call(this, action, handler)
        }
      }
    })
    await use(context)
  },
  page: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await use(page)
    expect(errors, 'uncaught page errors').toEqual([])
  },
})

export interface AudioState { src: string; t: number; paused: boolean; rate: number }

/** The narration element's state. */
export const audio = (page: Page) => page.evaluate(() => {
  const a = (window as unknown as { __audios: HTMLAudioElement[] }).__audios[0]
  return a ? { src: a.currentSrc || a.src, t: a.currentTime, paused: a.paused, rate: a.playbackRate } : null
})

/** How far `action` moved the playing audio, net of what played meanwhile (rate 1). */
export async function jumpOf(page: Page, action: () => Promise<unknown>): Promise<number> {
  const clock = () => page.evaluate(() => {
    const a = (window as unknown as { __audios: HTMLAudioElement[] }).__audios[0]
    return { t: a.currentTime, now: performance.now() }
  })
  const before = await clock()
  await action()
  // Let the seek land
  await page.waitForTimeout(300)
  await page.waitForFunction(() => {
    const a = (window as unknown as { __audios: HTMLAudioElement[] }).__audios[0]
    return !a.seeking && !a.paused
  })
  const after = await clock()
  return after.t - before.t - (after.now - before.now) / 1000
}

/** Index of the chapter the element plays (from the stub's redirect or saved copy), or -1. */
export function chapterOf(a: AudioState | null): number {
  const m = a && /(?:\/(\d+)\.m4a|\?(\d+))$/.exec(a.src)
  return m ? +(m[1] ?? m[2]) : -1
}

/** Wait until the element plays chapter `idx` past `from` seconds. */
export async function expectPlaying(page: Page, idx: number, from = 0.3, timeout = 15_000) {
  await expect.poll(async () => {
    const a = await audio(page)
    return a && !a.paused && chapterOf(a) === idx && a.t > from
  }, { timeout, message: `chapter ${idx + 1} playing` }).toBe(true)
}

export const bar = (page: Page) => page.locator('.fixed.bottom-0')
export const headerPlay = (page: Page) => page.locator('header').getByRole('button', { name: 'Play', exact: true })

/** On phones Save offline, text size and theme are behind the reader's "More" button (books#25). */
export async function openReaderMore(page: Page) {
  const more = page.getByRole('button', { name: 'More reading options' })
  if (await more.isVisible()) await more.click()
}

/** Open the reader at chapter `idx` of `book` (sidebar on wide screens, chapter drawer on phones). */
export async function openChapter(page: Page, idx: number, book = alice) {
  const aside = page.locator('aside button').nth(idx)
  if (await aside.isVisible()) return aside.click()
  const show = page.locator('header').getByRole('button', { name: 'Show chapters', exact: true })
  if (await show.isVisible()) {
    await show.click()
    return aside.click()
  }
  await page.locator('header').getByRole('button', { name: /^Chapters: chapter / }).click()
  await page.getByRole('button', { name: book.chapters[idx].title, exact: true }).click()
}

/** Previous/Next chapter: the bar's buttons, or the lock-screen action where the bar hides them. */
export async function trackButton(page: Page, dir: 'Next' | 'Previous') {
  const button = page.getByLabel(`${dir} chapter`)
  if (await button.isVisible()) return button.click()
  await page.evaluate(action => (window as unknown as { __ms: Record<string, () => void> }).__ms[action](),
    dir === 'Next' ? 'nexttrack' : 'previoustrack')
}

/**
 * Viewport point of char `offset` of the chapter text. With `scroll`, scrolls it
 * into view the way a reader would: a wheel event first, so the text stops
 * following the audio and doesn't scroll it away again before the click.
 */
export const charPoint = (page: Page, offset: number, scroll = true) => page.evaluate(async ([at, scroll]) => {
  if (scroll) {
    window.dispatchEvent(new WheelEvent('wheel'))
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))
  }
  const root = document.querySelector('div[title="Click to start listening from here"]')!
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let off = 0
  let n: Node | null
  while ((n = walker.nextNode())) {
    const len = n.textContent!.length
    if (off + len > at) {
      const r = document.createRange()
      r.setStart(n, at - off)
      r.setEnd(n, at - off + 1)
      if (scroll) n.parentElement!.scrollIntoView({ block: 'center', behavior: 'instant' })
      const b = r.getBoundingClientRect()
      return { x: b.x + 1, y: b.y + b.height / 2 }
    }
    off += len
  }
  throw new Error(`offset ${at} is past the text`)
}, [offset, scroll] as const)

/** Highlighted word and sentence text. */
export const marks = (page: Page) => page.evaluate(() => {
  const all = [...document.querySelectorAll('[data-readalong]')]
  let sentence: string | null = null
  if (all.length) {
    const r = document.createRange()
    r.setStartBefore(all[0])
    r.setEndAfter(all.at(-1)!)
    sentence = r.toString()
  }
  return { word: document.querySelector('[data-readalong="word"]')?.textContent ?? null, sentence }
})

/** Every user-visible "AI", ✦ or Kokoro: page text, title and attributes. */
export const aiMentions = (page: Page) => page.evaluate(() => {
  const found: string[] = []
  const test = (where: string, s: string | null) => {
    if (s && (/\bAI\b|✦/.test(s) || /kokoro/i.test(s))) found.push(`${where}: ${s.slice(0, 80)}`)
  }
  test('text', document.body.innerText)
  test('title', document.title)
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (!['class', 'style', 'd', 'src', 'href', 'viewBox'].includes(a.name)) test(`${el.tagName}@${a.name}`, a.value)
    }
  }
  return found
})

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/** axe-core violations on the page as it is now, one line per rule. */
export async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE })
  return page.evaluate(async () => {
    type Result = { violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<Result> } }).axe
    const { violations } = await axe.run(document, { resultTypes: ['violations'] })
    return violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(', ')}`)
  })
}

/** Select chapter text from char `start` to `end`, as a reader dragging over it would. */
export const selectText = (page: Page, start: number, end: number) => page.evaluate(([a, b]) => {
  const root = document.querySelector('[data-chapter-text]')!
  const at = (offset: number): [Node, number] => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let off = 0
    let n: Node | null
    while ((n = walker.nextNode())) {
      const len = n.textContent!.length
      if (off + len > offset) return [n, offset - off]
      off += len
    }
    throw new Error(`offset ${offset} is past the text`)
  }
  const r = document.createRange()
  r.setStart(...at(a))
  r.setEnd(...at(b))
  // Centre the selected words themselves (a long paragraph centred can leave them off a phone screen),
  // instantly: the app's CSS scrolls smoothly
  const box = r.getBoundingClientRect()
  window.scrollBy({ top: box.top + box.height / 2 - window.innerHeight / 2, behavior: 'instant' })
  getSelection()!.removeAllRanges()
  getSelection()!.addRange(r)
}, [start, end] as const)
