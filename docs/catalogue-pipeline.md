# The catalogue pipeline

How the catalogue's texts are built, how a build is kept reproducible, and how to change the
pipeline without breaking published books or their narration. To add a book, follow
[adding-books.md](adding-books.md). The plan to make the pipeline multi-language is books#38.

Each book is described once, in `edition/books/<slug>.toml`: its metadata, its source and split
options, and its cover. The format is documented in [edition/README.md](../edition/README.md).
`scripts/catalog/books.py` loads and validates those files; every other script reads the books
through it.

## What it produces

| Output | Made by | From |
|---|---|---|
| `edition/texts/<slug>.json`: `{"chapters": [{"title", "content"}]}` | `scripts/catalog/fetch.py` | the Gutenberg plain text, and the book's `[source]` |
| `edition/books.json`, the list the app shows (`CATALOG` in `catalog.ts`) | `scripts/catalog/books.py`, run by `fetch.py` after a build | the book files, plus each book's chapter count and reading time measured from its text |
| `edition/covers/<slug>.webp` and `edition/covers.json` | `scripts/catalog/covers.py` | the Gutenberg cover, or the book's `[cover]` (Wikimedia Commons, or none) |
| narration on Hugging Face (`<voice>/<slug>/<chapter>.m4a` and `.timings.json`) | `scripts/audio/` via the *Generate audio* workflow | the built files |

A chapter's `content` is exactly what the reader shows and what the narration reads. Narration
files are keyed by chapter **index**, and `timings.json` points at character offsets in `content`.
So once a book is narrated:

- **Changing its chapter split** (adding, removing or merging a chapter) makes every later
  chapter's audio belong to the wrong text.
- **Changing the length of a chapter's text** shifts the highlighted words.
- **Changing whitespace for whitespace** (a line break for a space) is safe. It keeps every offset,
  and the sentence splitter treats both alike.

## Reproducible builds

- **`edition/sources.lock.json`** pins the SHA-256 of every Gutenberg file a book is
  built from. Gutenberg sometimes re-releases a file. When that happens, `fetch.py` stops with
  "differs from the one in sources.lock.json" instead of quietly changing the book.
  - Rebuild the book and review the difference, including what it does to any narration.
  - Then run `fetch.py CACHE_DIR --relock SLUG` to accept the new file.
  - A new book's files are added to the lock on its first build.
- **`fetch.py CACHE_DIR --check [SLUG...]`** rebuilds books in memory and compares them with the
  committed files, writing nothing. It prints what differs, chapter by chapter, and exits 1 on any
  difference. It runs on every core, so the whole catalogue takes under a minute.
- **The *Catalogue pipeline* workflow** (`.github/workflows/pipeline.yml`) runs the unit and
  consistency tests, `--check` and `qa.py` on every push that touches `scripts/`, the catalogue or its data.
  It caches the Gutenberg files between runs.
- **`qa.py CACHE_DIR [SLUG...]`** verifies the committed text against an exact source rebuild,
  checks reviewed chapter counts and final words when provided, and checks for empty chapters,
  leftover licence text and markup. A book without a reproducible full-text source fails; it is
  never exempted as an excerpt. Short chapters and repeated narrator names are allowed because
  they can be part of the author's text. All failing books are reported, including source errors.

`scripts/catalog/test_catalog.py` holds the unit tests. Its consistency tests check that:
- `books.json` is exactly what the book files generate (so it was not edited by hand, and no one
  forgot to regenerate it after editing a book file);
- every book has its text and every text has its book;
- `covers.json` lists exactly the cover files, and no book marked `[cover] none` has one;
- every source is locked.

```bash
python3 scripts/catalog/test_catalog.py                            # needs Pillow
python3 scripts/catalog/books.py --check                           # books.json up to date
python3 scripts/catalog/fetch.py ~/.cache/books-gutenberg --check   # downloads missing sources first
python3 scripts/catalog/qa.py ~/.cache/books-gutenberg             # completeness and content checks
```

## Changing the pipeline

A change to `fetch.py`'s cleaning or splitting can change many books at once. Before you push one:

1. Run `--check` over the whole catalogue and read what changed. A check that passes means the
   change touched no book.
2. Sort the changes into **whitespace-only** (safe for narration), **text** and **structure**
   (chapter count or titles). Look at a sample from every book type: prose, verse, drama, and
   books with notes or letters.
3. If the change is right, rebuild (`fetch.py CACHE_DIR`), commit the rebuilt files with the
   script, and say in the commit which books changed and how.
4. If a narrated book's structure or text length changed, re-narrate it (see "Changing a book
   after it is narrated" in [adding-books.md](adding-books.md)).

A prose paragraph is unwrapped, while verse keeps its line breaks (`is_verse`). A block whose
lines all start with a capital used to count as verse. Prose that happened to wrap at capitals
("replied the / Scarecrow;") then kept its line breaks in 175 books, including Oz (books#33 fixed
two of those by hand). A block whose lines fill the wrap width and break mid-phrase is now prose,
unless the book sets `verse` (Poe's poems, *Cane*), whose long rhymed lines look the same.

## Language profiles

Everything in `fetch.py` and `scripts/audio/segments.py` that depends on the language of a text
lives in a language profile, `scripts/catalog/languages/<lang>.py` (books#56). A book's `language`
picks it (`es`, and `en-GB` would take `en`). The engine keeps what doesn't depend on the language:
the Gutenberg markers, paragraphs and verse, front matter, the lock.

| A profile holds | Used for |
|---|---|
| `GENERIC`, `KIND`, `MAJOR`, `SPECIAL`, `ARTICLE`, `LAST`, `number_word()` | headings: the words that mark one ("CAPÍTULO", "JORNADA"), their number words in every form a heading uses ("PRIMERA PARTE", "décimo tercero"), named headings (Prólogo) |
| `LABEL`, `PART` | a bare numeral's name ("Capítulo 12"), and the parts of a text without headings |
| `SMALL`, `NOT_ROMAN`, `OPENERS` | title case of ALL-CAPS headings |
| `EDITORIAL`, `BACK_MATTER`, `CONTENTS`, `BYLINE`, `MARKUP` | sections dropped by default (an editor's preface), where the back matter starts ("FIN", "ÍNDICE"), a contents list, a byline, editorial markup (`[Ilustración]`) |
| `WRAPPED_TITLES`, `VERSE_LOWER` | joining a heading's title wrapped onto the next lines; whether short lines starting in lowercase are verse |
| `END`, `ABBREVIATION` | where a narrated sentence ends: closing quotes (», ”), dialogue tags after a dash (`—¿Venta es ésta? —replicó`), abbreviations (Sr., Dña., Vd.) |
| `SPOKEN_KIND`, `spoken_number()` | how a chapter's title clip says its number ("Capítulo doce", "Tratado segundo") |

To add a language:

1. Copy `es.py` (or `en.py`) to `<lang>.py` and translate each item, from the Gutenberg texts the
   edition will use: look at how their chapters, parts, acts and front matter are marked before
   writing a pattern. Read the comments of `en.py` for what each item does.
2. Add unit tests next to the Spanish ones (`Spanish` in `scripts/catalog/test_catalog.py` and
   `scripts/audio/test_audio.py`): heading lines and their titles, number words, verse, sentences and
   spoken titles.
3. Build the language's books in a temporary edition outside this repository (config.json with the
   language, one book file each) and check every book by hand as [adding-books.md](adding-books.md)
   says: the chapter list, the first and last lines, no Gutenberg, editor or transcriber text.
   Change the profile for what most books share, and use a book's split options for what only it has.
   ```bash
   BOOKS_EDITION=/tmp/es-edition python3 scripts/catalog/fetch.py ~/.cache/books-gutenberg
   ```
4. Run `--check` over the English catalogue. A profile only changes books in its language, but a
   change to the engine to support it changes every book: keep English byte-identical (`en.py`
   switches a new behaviour off, as `WRAPPED_TITLES` does, when it would re-split English books).
