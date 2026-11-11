/**
 * The interface's words and formats in one language (books#54): `t(key, vars)` over a locale file
 * (en.json, es.json…), and the numbers, years and lengths written the way that language writes them.
 * Free of the edition's data, so the build config can use it (docs/editions.md); the app's locale,
 * chosen by the edition's language, is in index.ts.
 */
import type en from './en.json'

/** Every locale file has en.json's keys (test/unit/locales.test.ts checks it) */
export type Messages = typeof en
export type MessageKey = keyof Messages
export type Vars = Record<string, string | number>
/** A message with plural forms: Intl.PluralRules picks one by `count`, falling back to `other` */
type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }

export interface Locale {
  /** BCP 47 language, e.g. 'es' */
  language: string
  /** The message `key` with `{name}` filled from `vars`; numbers are written in the language */
  t: (key: MessageKey, vars?: Vars) => string
  /** A number in the language: 1.5 is "1,5" in Spanish. No thousands separator, as the app wrote them before */
  number: (n: number, fractionDigits?: number) => string
  /** A year of the books.json kind: negative years are BCE ("800 BC", "800 a. C.") */
  year: (year: number) => string
  /** A book's reading time from its minutes (books.json readMinutes), e.g. "1h 15min" */
  readTime: (minutes: number) => string
  /** A genre's label: books.json holds the fixed keys Fiction, Non-Fiction, Drama and Poetry */
  genre: (genre: string) => string
}

export function makeLocale(messages: Messages, language: string): Locale {
  const plurals = new Intl.PluralRules(language)
  const formats = new Map<number | undefined, Intl.NumberFormat>()
  const number = (n: number, fractionDigits?: number) => {
    let format = formats.get(fractionDigits)
    if (!format) {
      format = new Intl.NumberFormat(language, {
        useGrouping: false,
        ...(fractionDigits === undefined
          ? { maximumFractionDigits: 2 }
          : { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }),
      })
      formats.set(fractionDigits, format)
    }
    return format.format(n)
  }

  const t = (key: MessageKey, vars: Vars = {}) => {
    const message: string | Plural = messages[key]
    const text = typeof message === 'string' ? message : message[plurals.select(Number(vars.count))] ?? message.other
    // A missing variable stays visible as {name}, so a test sees it
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = vars[name]
      return value === undefined ? whole : typeof value === 'number' ? number(value) : value
    })
  }

  // Positive years are just the number; Intl writes the era of BCE years. Year 0 doesn't exist:
  // -800 (800 BC) is the astronomical year -799.
  const era = new Intl.DateTimeFormat(language, { year: 'numeric', era: 'short', timeZone: 'UTC' })
  const year = (y: number) => {
    if (y > 0) return String(y)
    const date = new Date(0)
    date.setUTCFullYear(y + 1)
    return era.format(date)
  }

  const readTime = (minutes: number) => {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h === 0 ? t('readTime.minutes', { m }) : m ? t('readTime.hoursMinutes', { h, m }) : t('readTime.hours', { h })
  }

  const genre = (g: string) => {
    const key = `genre.${g}`
    return key in messages ? t(key as MessageKey) : g
  }

  return { language, t, number, year, readTime, genre }
}
