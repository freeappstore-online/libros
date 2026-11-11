import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { makeLocale, type Messages } from '../../src/locales/locale'
import en from '../../src/locales/en.json'

// The interface in the edition's language (books#54)
const LOCALES = Object.fromEntries(readdirSync('src/locales').filter(f => f.endsWith('.json'))
  .map(f => [f.slice(0, -5), JSON.parse(readFileSync(join('src/locales', f), 'utf8')) as Record<string, unknown>]))

/** The {placeholders} of a message, across its plural forms */
const placeholders = (message: unknown) =>
  [...new Set(Object.values(typeof message === 'string' ? { message } : message as object)
    .flatMap(text => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1])))].sort()

describe.each(Object.keys(LOCALES))('the %s locale', language => {
  const messages = LOCALES[language]

  it("has exactly en.json's keys", () => {
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort())
  })

  it('fills the same placeholders, and has plural forms where English has them', () => {
    for (const [key, english] of Object.entries(en)) {
      expect(placeholders(messages[key]), key).toEqual(placeholders(english))
      expect(typeof messages[key], key).toBe(typeof english)
      if (typeof english === 'object') expect(messages[key], key).toHaveProperty('other')
    }
  })

  it("follows the wording rules: no AI, ✦ or Kokoro (e2e/wording.spec.ts)", () => {
    const text = JSON.stringify(messages)
    expect(text).not.toMatch(/\bAI\b|✦/)
    expect(text).not.toMatch(/kokoro/i)
  })

  it('has every plural form the language uses', () => {
    const forms = new Intl.PluralRules(language).resolvedOptions().pluralCategories
    for (const [key, message] of Object.entries(messages)) {
      // "many" is for millions in Spanish, Portuguese and French; "other" covers it
      if (typeof message === 'object') expect(Object.keys(message!).sort(), key).toEqual(forms.filter(f => f !== 'many').sort())
    }
  })
})

describe('formatting', () => {
  const english = makeLocale(en, 'en')
  const spanish = makeLocale(LOCALES.es as Messages, 'es')

  it('fills placeholders, writing numbers in the language', () => {
    expect(english.t('player.rate', { rate: 1.25 })).toBe('1.25x')
    expect(spanish.t('player.rate', { rate: 1.25 })).toBe('1,25x')
    expect(english.t('catalog.removeFilter', { tag: 'ghost story' })).toBe('Remove filter: ghost story')
  })

  it('picks the plural form by count', () => {
    expect(english.t('search.matches', { count: 1 })).toBe('1 match')
    expect(english.t('search.matches', { count: 2 })).toBe('2 matches')
    expect(spanish.t('search.chapters', { count: 1 })).toBe('1 capítulo')
    expect(spanish.t('search.chapters', { count: 1_000_000 })).toBe('1000000 capítulos')
  })

  it('writes BCE years with the era, and later ones as the number', () => {
    expect(english.year(1865)).toBe('1865')
    expect(english.year(-800)).toBe('800 BC')
    expect(spanish.year(-800)).toBe('800 a. C.')
    expect(spanish.year(-8)).toBe('8 a. C.')
  })

  it('writes reading times as the app always has in English', () => {
    expect([15, 45, 60, 90, 465].map(english.readTime)).toEqual(['15min', '45min', '1h', '1h 30min', '7h 45min'])
    expect([45, 120, 75].map(spanish.readTime)).toEqual(['45 min', '2 h', '1 h 15 min'])
  })

  it('labels genres, and keeps an unknown one as written', () => {
    expect(['Fiction', 'Non-Fiction', 'Drama', 'Poetry'].map(spanish.genre)).toEqual(['Ficción', 'No ficción', 'Teatro', 'Poesía'])
    expect(english.genre('Essays')).toBe('Essays')
  })
})

/**
 * Text written straight into a component, not taken from the locale. TypeScript parses each
 * component, and this looks where text reaches the screen: JSX text, the attributes people read
 * or hear (aria-label, title, alt…, and the components' own label props), and string or template
 * literals in a JSX expression's value position (`{busy ? 'Saving' : 'Save'}`). A string built
 * elsewhere (a hook's error message, a const) isn't seen here; the Spanish end-to-end test
 * (e2e/es/) catches those on screen.
 */
const TEXT_ATTRIBUTES = new Set(['aria-label', 'aria-valuetext', 'title', 'placeholder', 'alt', 'label', 'hint', 'subtitle', 'smaller', 'larger'])
/** Words, not symbols or a single letter (the A of the text size buttons) */
const hasWords = (text: string) => /\p{L}{2,}/u.test(text.replace(/&\w+;/g, ''))

function literalText(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const report = (node: ts.Node, text: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart())
    found.push(`${file}:${line + 1} ${JSON.stringify(text.trim())}`)
  }
  /** Is this expression what the JSX expression around it renders (not a condition, key or call argument)? */
  const rendered = (node: ts.Node): boolean => {
    const parent = node.parent
    if (ts.isJsxExpression(parent)) return !ts.isJsxAttribute(parent.parent) || TEXT_ATTRIBUTES.has(parent.parent.name.getText())
    if (ts.isParenthesizedExpression(parent) || ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent)) return rendered(parent)
    if (ts.isConditionalExpression(parent)) return parent.condition !== node && rendered(parent)
    if (ts.isBinaryExpression(parent)) {
      const op = parent.operatorToken.kind
      return (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) && rendered(parent)
    }
    return false
  }
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && hasWords(node.text)) report(node, node.text)
    else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText()) && node.initializer && ts.isStringLiteral(node.initializer) && hasWords(node.initializer.text)) {
      report(node, node.initializer.text)
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && hasWords(node.text) && rendered(node)) report(node, node.text)
    else if (ts.isTemplateExpression(node) && rendered(node)) {
      const parts = [node.head.text, ...node.templateSpans.map(s => s.literal.text)].join(' ')
      if (hasWords(parts)) report(node, parts)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const components = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? components(join(dir, entry.name)) : entry.name.endsWith('.tsx') ? [join(dir, entry.name)] : [])

it('components render no text of their own: it comes from the locale', () => {
  expect(components('src').flatMap(literalText)).toEqual([])
})

it('the check sees text where it reaches the screen, and only there', () => {
  const file = 'test/unit/literal-text.fixture.tsx'
  const found = literalText(file).map(f => f.replace(/^[^ ]+ /, ''))
  expect(found).toEqual(['"Saved"', '"Close"', '"Pause"', '"Play"', '"results"'])
})
