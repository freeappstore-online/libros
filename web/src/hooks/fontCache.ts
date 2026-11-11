/**
 * Google Fonts offline (books#26). The service worker caches fonts.googleapis.com and
 * fonts.gstatic.com (the SDK's pwaOptions, CacheFirst), but only requests it sees, and on
 * the first visit the page loads its fonts before the worker takes control (clientsClaim).
 * Without another online visit the app would show fallback fonts offline. So when the
 * worker first takes control, fetch the stylesheets and their latin font files again,
 * now through it. Later visits load them through the worker anyway.
 */
const FONT_CSS = /^https:\/\/fonts\.googleapis\.com\//

/** The Google Fonts stylesheets the page imports. */
function fontStylesheets(): string[] {
  const hrefs: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSImportRule && FONT_CSS.test(rule.href)) hrefs.push(rule.href)
      }
    } catch { /* another origin's sheet */ }
  }
  return hrefs
}

async function warm() {
  for (const href of fontStylesheets()) {
    const css = await (await fetch(href)).text()
    // The latin subset (U+0000-00FF, Œ œ, punctuation) covers the editions' languages so far: English,
    // and Spanish, Portuguese and French accents, ñ, ç, ¿ ¡ « » (books#54). Cyrillic needs its own (#60)
    const files = [...css.matchAll(/\/\* latin \*\/[^}]*?url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1])
    await Promise.all(files.map(url => fetch(url)))
  }
}

export function warmFontCacheOnFirstControl() {
  const sw = navigator.serviceWorker
  if (!sw || sw.controller) return
  sw.addEventListener('controllerchange', () => { warm().catch(() => {}) }, { once: true })
}
