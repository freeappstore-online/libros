"""The catalogue's books: one file per book, edition/books/<slug>.toml (books#38).

A book's file is the only place it is described: what the app shows about it, where its text comes
from and how that text is split ([source]), and where its cover comes from ([cover]). The format is
documented in catalog/README.md. Everything else is derived from these files:

- edition/texts/<slug>.json, the text: fetch.py
- edition/books.json, the list the app shows (with each book's chapter count and reading
  time, measured from its text): write_app_data(), which fetch.py calls after a build. After
  editing only a book's metadata, run this module on its own: python3 scripts/catalog/books.py
- edition/covers/<slug>.webp and edition/covers.json: covers.py

usage: books.py [--check]   (--check writes nothing and exits 1 if books.json is out of date)
"""
import json, os, re, sys, tomllib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Everything this app owns lives in its edition (docs/editions.md); BOOKS_EDITION points elsewhere (tests)
EDITION = os.path.abspath(os.environ.get("BOOKS_EDITION") or os.path.join(ROOT, "edition"))
with open(os.path.join(EDITION, "config.json"), encoding="utf-8") as _f:
    CONFIG = json.load(_f)
BOOKS_DIR = os.path.join(EDITION, "books")
TEXT_DIR = os.path.join(EDITION, "texts")
APP_DATA = os.path.join(EDITION, "books.json")
WORDS_PER_MIN = 250

# The app's genre filter: fixed keys, labelled in each language by the app's locale (books#54)
GENRES = ("Fiction", "Non-Fiction", "Drama", "Poetry")
REQUIRED = {"title": str, "author": str, "author_bio": str, "year": int, "genre": str, "tags": list,
            "language": str, "description": str, "excerpt": str, "look": dict, "source": dict}
OPTIONAL = {"cover": dict, "narration_revision": str}
# fetch.py's split options (what each does: catalog/README.md)
SPLIT_OPTIONS = {"heads", "heads_only", "toc", "start", "start_n", "end", "end_n", "drop", "first", "sub",
                 "nosub", "label", "titles", "level", "keep", "cut", "gloss", "strip", "verse"}


def _validate(slug: str, book: dict):
    """A book file is hand-edited, so say exactly what is wrong with one rather than fail later."""
    def bad(msg):
        raise SystemExit(f"edition/books/{slug}.toml: {msg}")
    for key, kind in {**REQUIRED, **OPTIONAL}.items():
        if key in book and not isinstance(book[key], kind):
            bad(f"{key} must be a {kind.__name__}")
    if missing := [k for k in REQUIRED if k not in book]:
        bad(f"missing {', '.join(missing)}")
    if unknown := set(book) - set(REQUIRED) - set(OPTIONAL):
        bad(f"unknown key(s) {', '.join(sorted(unknown))}")
    if book["genre"] not in GENRES:
        bad(f"genre must be one of {', '.join(GENRES)}")
    if set(book["look"]) != {"gradient", "accent"}:
        bad("[look] needs exactly gradient and accent")
    if "narration_revision" in book and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", book["narration_revision"]):
        bad("narration_revision must be a nonempty folder name using letters, digits, dots, underscores or hyphens")
    src = book["source"]
    if sum(k in src for k in ("gutenberg", "volumes", "standardebooks", "none")) != 1:
        bad("[source] needs exactly one of gutenberg, volumes, standardebooks or none")
    if "standardebooks" in src:
        if not isinstance(src["standardebooks"], str) or not re.fullmatch(r"[a-z0-9-]+/[a-z0-9-]+", src["standardebooks"]):
            bad("standardebooks must be author-slug/book-slug")
        if not isinstance(src.get("revision"), str) or not re.fullmatch(r"[0-9a-f]{40}", src["revision"]):
            bad("standardebooks needs a pinned 40-character revision")
        if not isinstance(src.get("expected_chapters"), int) or src["expected_chapters"] <= 0:
            bad("standardebooks needs positive expected_chapters")
        if not isinstance(src.get("ending"), str) or not src["ending"].strip():
            bad("standardebooks needs the reviewed final text in ending")
    for opts in [src, *src.get("volumes", [])]:
        if unknown := set(opts) - SPLIT_OPTIONS - {"gutenberg", "volumes", "none", "standardebooks", "revision", "expected_chapters", "ending"}:
            bad(f"unknown [source] option(s) {', '.join(sorted(unknown))}")
    cover = book.get("cover", {})
    if cover and sum(k in cover for k in ("commons", "none")) != 1 or set(cover) - {"commons", "crop", "page", "none"}:
        bad("[cover] holds either commons (and optional crop/page) or none")
    if "page" in cover and ("commons" not in cover or not cover["commons"].lower().endswith((".pdf", ".djvu"))
                            or type(cover["page"]) is not int or cover["page"] < 1):
        bad("[cover] page must be a positive page number of a Commons PDF or DjVu file")


def load() -> dict[str, dict]:
    books = {}
    # A new edition has no books yet (git keeps no empty folder)
    for name in sorted(os.listdir(BOOKS_DIR) if os.path.isdir(BOOKS_DIR) else []):
        if name.endswith(".toml"):
            with open(os.path.join(BOOKS_DIR, name), "rb") as f:
                books[name[:-5]] = book = tomllib.load(f)
            _validate(name[:-5], book)
    return books


CATALOG = load()


def source(book: dict):
    """(Gutenberg id, or a tuple of volumes (id, options), split options) as fetch.py takes them;
    None for a book not on Gutenberg, whose committed text is kept as it is."""
    src = book["source"]
    if "none" in src:
        return None
    if "standardebooks" in src:
        return src
    opts = {k: v for k, v in src.items() if k not in ("gutenberg", "volumes")}
    if "volumes" in src:
        return tuple((v["gutenberg"], {k: x for k, x in v.items() if k != "gutenberg"}) for v in src["volumes"]), opts
    ids = src["gutenberg"]
    return (tuple(ids) if isinstance(ids, list) else ids), opts


def read_time(words: int) -> int:
    """Reading time in minutes, to the quarter hour (at least 15). The app writes it in its language (books#54)."""
    return max(15, round(words / WORDS_PER_MIN / 15) * 15)


def app_data() -> list[dict]:
    """What the app lists (web/src/data/catalog.ts's CatalogBook), from the book files and texts."""
    out = []
    for slug, b in CATALOG.items():
        with open(os.path.join(TEXT_DIR, f"{slug}.json"), encoding="utf-8") as f:
            chapters = json.load(f)["chapters"]
        words = sum(len(c["content"].split()) for c in chapters)
        out.append({"id": slug, "title": b["title"], "author": b["author"], "authorBio": b["author_bio"],
                    "year": b["year"], "genre": b["genre"], "tags": b["tags"], "language": b["language"],
                    "description": b["description"], "excerpt": b["excerpt"], "chapters": len(chapters),
                    "readMinutes": read_time(words), "coverGradient": b["look"]["gradient"],
                    "coverAccent": b["look"]["accent"], "contentPath": f"/catalog/{slug}.json",
                    **({"narrationRevision": b["narration_revision"]} if b.get("narration_revision") else {})})
    return out


def render_app_data() -> str:
    """One book per line, so a change to a book is a one-line diff."""
    return "[\n" + ",\n".join(json.dumps(b, ensure_ascii=False) for b in app_data()) + "\n]\n"


def write_app_data():
    with open(APP_DATA, "w", encoding="utf-8") as f:
        f.write(render_app_data())


if __name__ == "__main__":
    if "--check" in sys.argv[1:]:
        with open(APP_DATA, encoding="utf-8") as f:
            current = f.read()
        if current != render_app_data():
            raise SystemExit("edition/books.json is out of date: run python3 scripts/catalog/books.py")
        print(f"edition/books.json is up to date ({len(CATALOG)} books)")
    else:
        write_app_data()
        print(f"wrote edition/books.json ({len(CATALOG)} books)")
