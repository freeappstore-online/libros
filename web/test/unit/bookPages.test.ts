import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATALOG } from '../../src/data/catalog'
import { EDITION } from '../../src/data/edition'
import { LOCALE } from '../../src/locales'
import { bookPage, openingParagraphs, sitemap } from '../../src/seo/bookPages'

// The static page per book for search engines (books#47)
const shell = readFileSync('index.html', 'utf8')
const book = { ...CATALOG.find(b => b.id === 'alice-in-wonderland')!, description: 'A girl & a "rabbit" </script><b>' }
const content = { chapterTitles: ['Down the Rabbit-Hole', 'The Pool of Tears'], opening: ['Alice was <tired>.'], narrated: 12, hasCover: true }
const meta = (html: string, key: string) => html.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`))?.[1]

describe('book page', () => {
  const html = bookPage(shell, book, content, EDITION, LOCALE)

  it('has its own title, description, canonical and social tags', () => {
    expect(html.match(/<title>[^<]*<\/title>/g)).toEqual(["<title>Alice's Adventures in Wonderland by Lewis Carroll: Read &amp; Listen Free Online | Books</title>"])
    expect(html).toContain('<link rel="canonical" href="https://books.freeappstore.online/read/alice-in-wonderland/" />')
    expect(meta(html, 'og:url')).toBe('https://books.freeappstore.online/read/alice-in-wonderland/')
    expect(meta(html, 'og:image')).toBe('https://books.freeappstore.online/covers/alice-in-wonderland.webp')
    expect(meta(html, 'description')).toContain('or listen to the audiobook. A girl &amp; a &quot;rabbit&quot; &lt;/script&gt;')
    expect(meta(html, 'twitter:title')).toBe(meta(html, 'og:title'))
  })

  it('keeps the app: its scripts load and the content goes in #root', () => {
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>')
    expect(html).toMatch(/<div id="root"><main[\s\S]*<h1[^>]*>Alice's Adventures in Wonderland<\/h1>/)
    expect(html).toContain('<li>The Pool of Tears</li>')
    expect(html).toContain('<p>Alice was &lt;tired&gt;.</p>')
    expect(html).toContain('every chapter is narrated')
  })

  it('book data can\'t end the structured-data script', () => {
    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]
    expect(jsonLd).not.toContain('</script>')
    expect(JSON.parse(jsonLd)).toMatchObject({ '@type': 'Book', name: book.title, author: { name: 'Lewis Carroll' }, datePublished: '1865' })
  })

  it('a reading-only book has no audiobook line or cover image when it has none', () => {
    const plain = bookPage(shell, book, { ...content, narrated: 0, hasCover: false }, EDITION, LOCALE)
    expect(plain).not.toContain('Audiobook')
    expect(plain).not.toContain('og:image')
    expect(meta(plain, 'description')).not.toContain('listen')
  })

  it('fails the build when index.html loses a tag it fills in', () => {
    expect(() => bookPage(shell.replace(/<meta property="og:url"[^>]*>/, ''), book, content, EDITION, LOCALE)).toThrow(/og:url/)
  })
})

it('the opening stops after about 1500 characters, at a paragraph end', () => {
  const paragraph = 'x'.repeat(600)
  expect(openingParagraphs(`${paragraph}\n\n${paragraph}\n \n${paragraph}\n\n${paragraph}`)).toHaveLength(3)
  expect(openingParagraphs('Short.\n\n\n\nAnother.')).toEqual(['Short.', 'Another.'])
})

it('the sitemap lists the home page and every book page', () => {
  const xml = sitemap(['a', 'b'], EDITION.site)
  expect(xml.match(/<loc>[^<]*<\/loc>/g)).toEqual([
    '<loc>https://books.freeappstore.online/</loc>',
    '<loc>https://books.freeappstore.online/read/a/</loc>',
    '<loc>https://books.freeappstore.online/read/b/</loc>',
  ])
})
