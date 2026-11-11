"""Split the catalogue chapters that still lack narration into shards that fit a CI job (books#4).

usage: plan.py CATALOG_DIR REPO VOICE [--force] [--titles] SLUG...|all-existing
Only the named books are planned; there is no "every book" mode on purpose (books#27).
Prints a GitHub Actions matrix: {"include": [{"shard": 0, "units": "slug:0 slug:1 ..."}, ...]}.
A chapter counts as done once REPO has VOICE/<slug>/<chapter>.m4a; --force narrates it again
(e.g. audio made before it came with timings, books#22). Shards keep a book's
chapters together and hold at most SHARD_CHARS characters: Kokoro narrates ~40 chars per
second of CPU on a GitHub runner, so 600k chars is ~4 h, inside the 6 h job limit.
--titles plans only the title clips (<chapter>.title.m4a) missing next to chapters that are
already narrated, all of them with --force (books#37); there all-existing names every book with
audio in VOICE, since a title is only ever added to a narrated chapter.
"""
import json, os, sys
from huggingface_hub import HfApi
from manifest import ALL_EXISTING, audio_prefix, check_slugs, existing
from engine import check, language
from segments import spoken_title

SHARD_CHARS = 600_000
TITLE_COST = 40  # chars a title clip's two ffmpeg passes take as long as

catalog, repo, voice, *only = sys.argv[1:]
check(catalog, voice)  # an edition its engine can't narrate stops here, before any job starts
lang = language(catalog)
force, titles = "--force" in only, "--titles" in only
only = [slug for slug in only if slug not in ("--force", "--titles")]
if titles and only == [ALL_EXISTING]:
    only = existing(repo, voice)
check_slugs(catalog, only)
files = set() if force and not titles else set(HfApi().list_repo_files(repo, repo_type="dataset"))
shards: list[list] = []
size = SHARD_CHARS
for slug in sorted(set(only)):
    for i, ch in enumerate(json.load(open(os.path.join(catalog, f"{slug}.json")))["chapters"]):
        audio = f"{audio_prefix(catalog, voice, slug)}/{i}"
        if titles:
            chars = len(spoken_title(ch["title"], lang)) + TITLE_COST
            if chars == TITLE_COST or f"{audio}.m4a" not in files or (f"{audio}.title.m4a" in files and not force):
                continue
        else:
            chars = len(ch["content"].strip())
            if not chars or f"{audio}.m4a" in files:
                continue
        if size + chars > SHARD_CHARS:
            shards.append([])
            size = 0
        shards[-1].append(f"{slug}:{i}")
        size += chars
print(json.dumps({"include": [{"shard": n, "units": " ".join(s)} for n, s in enumerate(shards)]}))
