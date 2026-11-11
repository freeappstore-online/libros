"""Make timings.json for chapters narrated before generate.py wrote them (books#22).

usage: backfill_timings.py CATALOG_DIR REPO VOICE SLUG...
For every VOICE/<slug>/<chapter>.m4a in REPO without a .timings.json next to it, finds the pauses
in the audio and picks the ones that best line up with the sentence boundaries: a boundary is
expected where its share of the chapter's characters falls in the speech, and longer pauses are
preferred, since a sentence end pauses longer than a comma. Each book's timings are committed
together. Re-narrating gives exact timings; this is the cheap way for audio that already exists.
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from huggingface_hub import HfApi, hf_hub_download
from manifest import CHAPTER, audio_prefix, check_slugs
from segments import sentences, utf16

SR = 24_000
FRAME = SR // 100  # 10 ms
QUIET_DB = 40  # a frame this far below loud speech counts as silence
MIN_PAUSE = 0.08  # seconds
PAUSE_WEIGHT = 10  # seconds of misplacement one second of pause is worth
SKIP_COST = 3  # cost of a boundary with no pause found for it


def pauses(path: str) -> tuple[np.ndarray, float, float]:
    """(start, end) of each pause in the audio, and where speech starts and ends, in seconds."""
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    audio = np.frombuffer(pcm, np.int16).astype(np.float32)
    frames = audio[:len(audio) // FRAME * FRAME].reshape(-1, FRAME)
    db = 10 * np.log10(np.mean(frames ** 2, axis=1) + 1e-9)
    loud = db > np.percentile(db, 95) - QUIET_DB
    edges = np.flatnonzero(np.diff(loud.astype(np.int8)))  # last frame before each change
    first, last = np.flatnonzero(loud)[[0, -1]]
    starts = edges[~loud[edges + 1] & (edges >= first) & (edges < last)] + 1  # speech -> silence
    ends = edges[np.searchsorted(edges, starts)] + 1  # silence -> speech
    keep = (ends - starts) * FRAME / SR >= MIN_PAUSE
    return np.stack([starts[keep], ends[keep]], axis=1) * FRAME / SR, first * FRAME / SR, (last + 1) * FRAME / SR


def align(content: str, gaps: np.ndarray, start: float, end: float) -> list:
    """Segments for the sentences of content, cutting the speech at the best-fitting pauses."""
    spans = sentences(content, "en")  # English audio only: other editions are narrated with timings
    chars = np.cumsum([e - s for s, e, _ in spans], dtype=float)
    expected = start + (end - start) * chars[:-1] / chars[-1]  # each boundary between sentences
    mid, length = gaps.mean(axis=1), gaps[:, 1] - gaps[:, 0]
    n, k = len(expected), len(gaps)
    # States: the last pause used so far, 0..k-1, or k for none yet. best is the cost of each state
    # after j boundaries; back[j] the state each came from.
    best = np.full(k + 1, np.inf)
    best[k] = 0
    back = np.zeros((n, k + 1), int)
    for j in range(n):
        earlier = np.concatenate([best[k:], best[:k]])  # position i: state k if i == 0, else i - 1
        low = np.minimum.accumulate(earlier)
        at = np.maximum.accumulate(np.where(earlier == low, np.arange(k + 1), 0))
        take = low[:k] + np.abs(mid - expected[j]) - PAUSE_WEIGHT * np.minimum(length, 1.0)
        skip = best + SKIP_COST
        back[j] = np.arange(k + 1)
        took = take < skip[:k]
        back[j, :k][took] = np.where(at[:k] == 0, k, at[:k] - 1)[took]
        best = np.concatenate([np.where(took, take, skip[:k]), skip[k:]])
    # Walk back from the cheapest final state; a boundary with no pause is placed by its characters
    cuts = []
    state = int(np.argmin(best))
    for j in range(n - 1, -1, -1):
        prev = back[j, state]
        cuts.append(tuple(gaps[state]) if prev != state else None)
        state = prev
    cuts.reverse()
    times = [start] + [t for c in cuts for t in (c or (None, None))] + [end]
    for i, t in enumerate(times):
        if t is None:  # between the known times around it, by characters
            lo = max(x for x in range(i) if times[x] is not None)
            hi = min(x for x in range(i + 1, len(times)) if times[x] is not None)
            c = lambda x: chars[(x - 1) // 2] if x else 0.0  # characters before times[x]
            times[i] = times[lo] + (times[hi] - times[lo]) * (c(i) - c(lo)) / max(c(hi) - c(lo), 1)
    u16 = utf16(content)
    return [[u16[s], u16[e], round(times[2 * i], 3), round(times[2 * i + 1], 3)] for i, (s, e, _) in enumerate(spans)]


if __name__ == "__main__":
    catalog, repo, voice, *only = sys.argv[1:]
    check_slugs(catalog, only)  # the named books only (books#27)
    api = HfApi()
    files = set(api.list_repo_files(repo, repo_type="dataset"))
    todo: dict[str, list[int]] = {}
    prefixes = {audio_prefix(catalog, voice, slug): slug for slug in only}
    for f in sorted(files):
        prefix, name = f.rsplit("/", 1) if "/" in f else ("", f)
        if prefix in prefixes and CHAPTER.fullmatch(f):
            if f.removesuffix(".m4a") + ".timings.json" not in files:
                todo.setdefault(prefixes[prefix], []).append(int(name.removesuffix(".m4a")))
    for slug, chapters in todo.items():
        book = json.load(open(f"{catalog}/{slug}.json"))["chapters"]
        prefix = audio_prefix(catalog, voice, slug)
        with tempfile.TemporaryDirectory() as out:
            os.makedirs(f"{out}/{prefix}")
            for i in sorted(chapters):
                gaps, start, end = pauses(hf_hub_download(repo, f"{prefix}/{i}.m4a", repo_type="dataset"))
                segments = align(book[i]["content"], gaps, start, end)
                json.dump({"v": 1, "segments": segments}, open(f"{out}/{prefix}/{i}.timings.json", "w"),
                          separators=(",", ":"))
                print(f"{slug}:{i}: {len(segments)} segments, {len(gaps)} pauses", flush=True)
            api.upload_folder(repo_id=repo, repo_type="dataset", folder_path=out,
                              commit_message=f"{voice}/{slug}: backfilled timings for {len(chapters)} chapter(s)")
