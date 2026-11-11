# Editions: one engine, an app per language

Books is the engine of several apps: this one (English), and language apps such as `libros` (Spanish,
books#59). Each language app is a **fork** of this repository that merges `books` main from time to time
(books#38, #58). Each one keeps its own **edition**. What separates them is one folder.

## The boundary

| Owned by each app (never merged from `books`) | Shared: the engine (only ever changed in `books`) |
|---|---|
| `edition/`: `config.json`, `books/`, `sources.lock.json`, `texts/`, `books.json`, `covers/`, `covers.json`, `public/` | everything else: `web/`, `scripts/`, the workflows except `deploy.yml`, `docs/` |
| `README.md`, `fas.json`, `.github/workflows/deploy.yml` (written by `fas publish`) | |

Engine code never names an app. Anything that differs between apps, such as the name, language,
addresses, title, descriptions or narration dataset and voice, comes from `edition/config.json`. The
format of each file is in [edition/README.md](../edition/README.md).

## How the engine reads the edition

- **The app:** `@edition/*` is an alias for the edition folder (`web/vite.config.ts`,
  `web/vitest.config.ts`, the `paths` in the tsconfigs):
  - `src/data/edition.ts` exposes `config.json` as `EDITION`;
  - `src/data/catalog.ts` reads `books.json`, and `src/data/covers.ts` reads `covers.json`.
- **The build config** can't use that alias. `vite.config.ts` reads the edition's files from disk, and
  imports only modules that don't load edition data (`src/data/book.ts`, `src/hooks/manifest.ts`,
  `src/seo/bookPages.ts`). A module that needs the edition imports it through `@edition`, and the
  config must not import that module.
- **The build** (the `edition` plugin in `vite.config.ts`):
  - fills `{{edition.<key>}}` in `index.html` from the config;
  - writes `manifest.json` from `public/manifest.json` with the config's name and language;
  - copies `texts/` to `/catalog/` and `covers/` to `/covers/`. Those URLs never change: saved books,
    read-along timings and resume positions are keyed by them.
  - copies `public/` to the site root.
- **The scripts:** `scripts/catalog/books.py` resolves the edition (`EDITION`, `CONFIG`), and the
  other scripts take their paths from it. The workflows read `audio.dataset` and `audio.voice` from
  the config.
- **Another edition:** `BOOKS_EDITION=/path/to/edition` points the build, the unit tests, the
  scripts and the marketing generator at it.

## The interface language

The interface is in the edition's `language` (books#54). Its words are in the engine, one locale file
per language, `web/src/locales/<language>.json`, so a fix to a translation reaches every app in that
language. A build for a language without a locale file fails.

- **Messages:** `t(key, vars)` (`src/locales/index.ts`) fills a message's `{placeholders}`. A message with
  plural forms (`{ "one": …, "other": … }`) is chosen by `Intl.PluralRules` from `count`.
- **Formats** (`src/locales/locale.ts`): numbers, BCE years ("800 a. C."), reading times (`books.json`
  has `readMinutes`), and genre labels. `genre` in a book file is one of the fixed keys `Fiction`,
  `Non-Fiction`, `Drama` and `Poetry`, whatever the edition's language; tags are written in it.
- **The static pages** (`index.html`, the book pages) take their words from the same locale:
  `vite.config.ts` reads the locale file from disk and passes it to `bookPage`.
- **Checks:** `test/unit/locales.test.ts` fails when a locale's keys or placeholders differ from
  `en.json`'s, or when a component renders text of its own instead of the locale's. The `es`
  Playwright project walks the app built from a Spanish test edition (`web/test/edition-es/`) and fails
  on any English left on screen.
- **A new language:** copy `en.json`, translate every message, add it to `LOCALES` in
  `src/locales/index.ts`, and have a fluent speaker read it before the app launches.

## Keeping a language app in sync

- **`scripts/edition/sync-upstream.sh`** merges `books` main into a language app:
  - the app's own paths stay exactly as they are;
  - new English books and `books`' README are dropped;
  - a conflict in engine files stops it, and the files are listed.
- **`scripts/edition/check-engine.sh`** fails when the app has changed engine files since the last
  `books` commit it merged.
- **Workflows:** `.github/workflows/sync.yml` runs the sync weekly or by hand, checks the result,
  pushes, deploys, and opens an issue when it fails. `engine-check.yml` runs the drift check on
  every push. In `books` itself both workflows skip.
- **Creating a language app, step by step:** [new-language-app.md](new-language-app.md).
