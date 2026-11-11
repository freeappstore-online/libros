// The app's locale: the edition's language (edition/config.json). A language app needs its locale
// file here, upstream in books, so a fix to a translation reaches every app in that language.
import { EDITION } from '../data/edition'
import { makeLocale, type Messages } from './locale'
import en from './en.json'
import es from './es.json'

const LOCALES: Record<string, Messages> = { en, es }

const messages = LOCALES[EDITION.language]
if (!messages) throw new Error(`No locale for the edition's language "${EDITION.language}": add web/src/locales/${EDITION.language}.json`)

export const LOCALE = makeLocale(messages, EDITION.language)
export const { t } = LOCALE
