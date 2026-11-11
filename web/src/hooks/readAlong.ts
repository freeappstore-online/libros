/**
 * Read-along: where in the chapter text the audio is (books#20).
 *
 * The prepared narration ships sentence timings next to each chapter's audio;
 * the spoken word inside a sentence is estimated by spreading the sentence's
 * time over its words by syllable count.
 */
import { getManifestExtras, hasTimings, preparedTimingsUrl } from './preparedAudio'
import { fetchSavedOr } from './offlineBooks'

/** Char range [start, end) in the chapter content. */
export type CharRange = [number, number]

export interface ReadAlongPosition {
  chapterIdx: number
  sentence: CharRange | null
  word: CharRange | null
}

/** [charStart, charEnd, startSec, endSec] */
export type TimingSegment = [number, number, number, number]

const timingsCache = new Map<string, Promise<TimingSegment[] | null>>()

/** Sentence timings of a narrated chapter; null when it has none. */
export function loadTimings(slug: string, chapterIdx: number): Promise<TimingSegment[] | null> {
  // The manifest says which books have timings: no request (and no console 404) for the others
  if (!hasTimings(getManifestExtras(), slug)) return Promise.resolve(null)
  const url = preparedTimingsUrl(slug, chapterIdx)
  let p = timingsCache.get(url)
  if (!p) {
    // Saved books keep their timings on the device (offline reading)
    // Timings not published (404) stay known; a failed request is tried again the next time
    // the chapter plays, rather than leaving it without read-along until a reload
    const retry = () => { timingsCache.delete(url); return null }
    p = fetchSavedOr(url)
      .then(r => (r.ok ? r.json() : r.status === 404 ? null : retry()))
      .then(d => (Array.isArray(d?.segments) && d.segments.length > 0 ? d.segments as TimingSegment[] : null))
      .catch(retry)
    timingsCache.set(url, p)
  }
  return p
}

/**
 * A sentence ends at . ! ? or … (with any closing quotes or brackets) before a space, as the
 * narration pipeline splits them (scripts/audio/segments.py), and not when a lowercase word follows:
 * `“Oh dear!” said the Rabbit`, and Spanish dialogue `¿Qué hora es? —preguntó`, whose tag opens
 * with a dash (or Gutenberg's --), as the Spanish profile has it (scripts/catalog/languages/es.py).
 * Sentences may start with ¿ or ¡ and close with », which this keeps.
 */
const SENTENCE_END = /[.!?…]+["'”’»)\]]*(?=\s)(?![^\S\n]+(?:[—–-]+[^\S\n]?)?\p{Ll})|\n/gu

/** Sentence ranges of `text`. */
export function sentenceRanges(text: string): CharRange[] {
  const ranges: CharRange[] = []
  let start = 0
  const push = (end: number) => {
    while (start < end && /\s/.test(text[start])) start++
    if (start < end) ranges.push([start, end])
    start = end
  }
  for (const m of text.matchAll(SENTENCE_END)) push(m.index + m[0].length)
  push(text.length)
  return ranges
}

/**
 * Rough syllable count, plus a beat for the pause after a comma or dash. Vowels count with their
 * accents (á, ü, ã, ê…: compared without them), and a stressed í or ú next to another vowel is a
 * syllable of its own (Spanish día, oído; books#54).
 */
export function wordWeight(word: string): number {
  const plain = word.normalize('NFD').replace(/\p{M}/gu, '')
  const syllables = (plain.match(/[aeiouy]+/gi)?.length ?? 0) + (word.match(/[aeiou][íú]|[íú][aeiou]/gi)?.length ?? 0)
  return Math.max(1, syllables) + (/[,;:—–-]["'”’»)\]]*$/.test(word) ? 1 : 0)
}

function words(text: string, [start, end]: CharRange): { range: CharRange; weight: number }[] {
  const out: { range: CharRange; weight: number }[] = []
  for (const m of text.slice(start, end).matchAll(/\S+/g)) {
    out.push({ range: [start + m.index, start + m.index + m[0].length], weight: wordWeight(m[0]) })
  }
  return out
}

/** Last index whose value from `key` is <= `x` (0 when none). */
function lastAtOrBefore<T>(items: T[], x: number, key: (item: T) => number): number {
  let lo = 0, hi = items.length - 1, found = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (key(items[mid]) <= x) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found
}

/** Sentence and estimated word spoken at `t` seconds, from the timings. */
export function positionFromTimings(text: string, segments: TimingSegment[], t: number): { sentence: CharRange; word: CharRange | null } {
  // A seek to a sentence's start can land a sample before it
  const seg = segments[lastAtOrBefore(segments, t + 0.02, s => s[2])]
  const sentence: CharRange = [seg[0], seg[1]]
  const ws = words(text, sentence)
  if (ws.length === 0) return { sentence, word: null }
  const total = ws.reduce((sum, w) => sum + w.weight, 0)
  const span = seg[3] - seg[2]
  const target = span > 0 ? Math.min(1, Math.max(0, (t - seg[2]) / span)) * total : 0
  let acc = 0
  for (const w of ws) {
    acc += w.weight
    if (acc > target) return { sentence, word: w.range }
  }
  return { sentence, word: ws[ws.length - 1].range }
}

/** Seconds at which the word at char `offset` is spoken, from the timings. */
export function timeAtChar(text: string, segments: TimingSegment[], offset: number): number {
  // The sentence holding the offset, or the next one when it falls between sentences
  let i = lastAtOrBefore(segments, offset, s => s[0])
  if (offset >= segments[i][1] && i + 1 < segments.length) i++
  const seg = segments[i]
  const ws = words(text, [seg[0], seg[1]])
  const total = ws.reduce((sum, w) => sum + w.weight, 0)
  let before = 0
  for (const w of ws) {
    if (w.range[1] > offset) break
    before += w.weight
  }
  return seg[2] + (total > 0 ? before / total : 0) * (seg[3] - seg[2])
}

/** Seconds at which char `offset` is spoken: from the timings, else by its share of the chapter. */
export function timeForChar(text: string, segments: TimingSegment[] | null, offset: number, duration: number): number {
  return segments ? timeAtChar(text, segments, offset) : offset / Math.max(1, text.length) * duration
}
