"""Tests of the pure parts of the narration scripts, against the real catalogue (books#27).

usage: python scripts/audio/test_audio.py   (needs requirements.txt installed and ffmpeg; no network)
"""
import contextlib, io, json, os, runpy, subprocess, sys, tempfile, unittest
from types import SimpleNamespace
from unittest import mock
import numpy as np
import soundfile as sf
import manifest
from generate import encode, loudness, trim
from manifest import audio_prefix, build, build_extras, check_slugs, duration, merge
from segments import sentences, spoken_title, utf16

CATALOG = os.path.join(os.path.dirname(__file__), "../../web/test/edition/texts")
ALICE = "alice-in-wonderland"


class Manifest(unittest.TestCase):
    def test_restored_text_never_reuses_legacy_audio(self):
        with tempfile.TemporaryDirectory() as catalog:
            slug = "restored-book"
            with open(os.path.join(catalog, f"{slug}.json"), "w") as f:
                json.dump({"narrationRevision": "complete-text-v1", "chapters": [{"title": "One", "content": "Full text"}]}, f)
            legacy = {f"af_heart/{slug}/0.m4a": 300}
            prefix = audio_prefix(catalog, "af_heart", slug)
            self.assertEqual(prefix, f"af_heart/{slug}/complete-text-v1")
            self.assertEqual(build(catalog, "af_heart", legacy, [slug]), {})
            self.assertEqual(build_extras(catalog, "af_heart", legacy, set(), [slug]), {})
            revised = {**legacy, f"{prefix}/0.m4a": 600}
            self.assertEqual(build(catalog, "af_heart", revised, [slug]), {slug: [600]})
            self.assertEqual(build_extras(catalog, "af_heart", revised, set(), [slug])[slug]["textRevision"], "complete-text-v1")
            # A normal regeneration must schedule this chapter even though its old-index
            # recording exists, without requiring a destructive force or dataset cleanup.
            api = mock.Mock()
            api.list_repo_files.return_value = list(legacy)
            output = io.StringIO()
            with mock.patch("huggingface_hub.HfApi", return_value=api), \
                 mock.patch.object(sys, "argv", ["plan.py", catalog, "repo", "af_heart", slug]), \
                 contextlib.redirect_stdout(output):
                runpy.run_path(os.path.join(os.path.dirname(__file__), "plan.py"), run_name="__main__")
            self.assertEqual(json.loads(output.getvalue())["include"][0]["units"], f"{slug}:0")

    def test_slugs_are_required_and_must_exist(self):
        with self.assertRaises(SystemExit):
            check_slugs(CATALOG, [])
        with self.assertRaises(SystemExit):
            check_slugs(CATALOG, [ALICE, "no-such-book"])
        check_slugs(CATALOG, [ALICE])

    def test_build_only_the_named_books_in_the_voice(self):
        seconds = {f"af_heart/{ALICE}/0.m4a": 655.159, f"af_heart/{ALICE}/2.m4a": 557.8,
                   "af_heart/dracula/0.m4a": 900.0, f"bf_emma/{ALICE}/0.m4a": 700.0}
        books = build(CATALOG, "af_heart", seconds, [ALICE])
        self.assertEqual(list(books), [ALICE])
        self.assertEqual(len(books[ALICE]), 12)
        self.assertEqual(books[ALICE][:3], [655.2, None, 557.8])

    def test_merge_keeps_other_entries_and_never_adds_other_books(self):
        manifest = {"af_heart": {ALICE: [1.0] * 12, "dracula": [2.0]}, "bf_emma": {ALICE: [3.0]}}
        out = merge(manifest, "af_heart", {ALICE: [5.0] * 12}, {}, [ALICE])
        self.assertEqual(out, {"af_heart": {ALICE: [5.0] * 12, "dracula": [2.0]}, "bf_emma": {ALICE: [3.0]}})
        self.assertEqual(manifest["af_heart"][ALICE], [1.0] * 12)  # input untouched
        # A named book with no audio drops out; an empty voice disappears
        self.assertEqual(merge({"af_heart": {ALICE: [1.0]}}, "af_heart", {}, {}, [ALICE]), {})

    def test_merge_extras_like_the_voices_and_never_as_a_voice(self):
        """extras sits next to the voices (books#37): its named books are replaced, the rest kept."""
        old = {"af_heart": {ALICE: [1.0], "dracula": [2.0]},
               "extras": {"af_heart": {ALICE: {"timings": True, "titles": [None]},
                                       "dracula": {"timings": False, "titles": [1.5]}}}}
        new = {ALICE: {"timings": True, "titles": [2.25]}}
        out = merge(old, "af_heart", {ALICE: [5.0]}, new, [ALICE])
        self.assertEqual(out, {"af_heart": {ALICE: [5.0], "dracula": [2.0]},
                               "extras": {"af_heart": {ALICE: new[ALICE], "dracula": {"timings": False, "titles": [1.5]}}}})
        self.assertEqual(merge({"af_heart": {ALICE: [1.0]}}, "af_heart", {}, {}, [ALICE]), {})  # no empty extras

    def test_extras_flag_timings_and_list_title_lengths(self):
        v = f"af_heart/{ALICE}"
        seconds = {f"{v}/0.m4a": 655.2, f"{v}/0.title.m4a": 2.345, f"{v}/2.m4a": 557.8, "af_heart/dracula/0.m4a": 9.0}
        extras = build_extras(CATALOG, "af_heart", seconds, {f"{v}/0.m4a"}, [ALICE])
        self.assertEqual(list(extras), [ALICE])
        self.assertEqual(extras[ALICE], {"timings": False, "titles": [2.35] + [None] * 11})  # 2.m4a has none
        extras = build_extras(CATALOG, "af_heart", seconds, {f"{v}/0.m4a", f"{v}/2.m4a"}, [ALICE])
        self.assertTrue(extras[ALICE]["timings"])
        self.assertEqual(build_extras(CATALOG, "af_heart", {}, set(), [ALICE]), {})  # no audio, no entry


class Durations(unittest.TestCase):
    def test_duration_is_the_real_audio_length(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "0.m4a")
            subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=2.5", "-ac", "1",
                            "-c:a", "aac", "-b:a", "40k", path], check=True)
            self.assertAlmostEqual(duration(path), 2.5, delta=0.05)

    def test_publish_takes_timings_ends_else_probes_and_nulls_missing_chapters(self):
        """Alice-like chapters with timings use them; audio without timings is probed, never sized (books#31)."""
        tree = [SimpleNamespace(path=p, blob_id=f"b{i}") for i, p in enumerate([
            f"af_heart/{ALICE}/0.m4a", f"af_heart/{ALICE}/0.timings.json", f"af_heart/{ALICE}/0.title.m4a",
            f"af_heart/{ALICE}/2.m4a", "af_heart/dracula/0.m4a"])]
        api = mock.Mock()
        api.repo_info.return_value = SimpleNamespace(sha="head")
        api.list_repo_tree.return_value = tree
        with tempfile.TemporaryDirectory() as d:
            timings = os.path.join(d, "t.json")
            json.dump({"v": 1, "segments": [[0, 5, 0.0, 1.0], [6, 9, 1.4, 655.159]]}, open(timings, "w"))
            empty = os.path.join(d, "m.json")
            json.dump({"af_heart": {"dracula": [1.0]}}, open(empty, "w"))
            download = lambda repo, path, **kw: empty if path == "manifest.json" else timings
            with mock.patch.object(manifest, "HfApi", return_value=api), \
                 mock.patch.object(manifest, "hf_hub_download", side_effect=download), \
                 mock.patch.object(manifest, "remote_duration", side_effect=lambda r, p, h: 1.5 if "title" in p else 557.84) as probe:
                out = manifest.publish(CATALOG, "repo", "af_heart", [ALICE])
        self.assertEqual(sorted(c.args[1] for c in probe.call_args_list),
                         [f"af_heart/{ALICE}/0.title.m4a", f"af_heart/{ALICE}/2.m4a"])
        self.assertEqual(out["af_heart"][ALICE], [655.2, None, 557.8] + [None] * 9)
        self.assertEqual(out["af_heart"]["dracula"], [1.0])  # not named: kept as it was
        self.assertEqual(out["extras"], {"af_heart": {ALICE: {"timings": False, "titles": [1.5] + [None] * 11}}})


class Encoding(unittest.TestCase):
    def test_encode_normalises_loudness_without_moving_the_audio(self):
        """-18 LUFS, true peak <= -1 dBTP, the band above 8 kHz kept, same length, nothing shifted:
        timings stay exact (books#37)."""
        sr = 24_000
        t = np.arange(int(6.5 * sr)) / sr
        # a quiet "voice" of tone bursts with some 10 kHz "sibilance" and a loud click, so the gain is
        # limited by the peak
        x = ((0.05 * np.sin(2 * np.pi * 220 * t) + 0.01 * np.sin(2 * np.pi * 10_000 * t))
             * (np.sin(2 * np.pi * 1.5 * t) > 0)).astype(np.float32)
        x[3 * sr] = 0.99
        with tempfile.TemporaryDirectory() as d:
            sf.write(f"{d}/in.wav", x, sr)
            encode(f"{d}/in.wav", f"{d}/out.m4a")
            lufs, peak = loudness(f"{d}/out.m4a")
            self.assertAlmostEqual(lufs, -18, delta=1)
            self.assertLessEqual(peak, -1.0)
            self.assertAlmostEqual(duration(f"{d}/out.m4a"), len(x) / sr, delta=0.001)
            y = np.frombuffer(subprocess.run(["ffmpeg", "-loglevel", "error", "-i", f"{d}/out.m4a", "-f", "f32le",
                                              "-ac", "1", "-ar", str(sr), "-"], capture_output=True, check=True).stdout,
                              np.float32)
            # ffmpeg 9 trims the encoder's end padding when decoding; 6.1 (Ubuntu 24.04) keeps up to a frame
            self.assertTrue(0 <= len(y) - len(x) < 1024, (len(y), len(x)))
            # the first burst starts where it did: compare the envelopes' onsets
            onset = lambda a: int(np.argmax(np.abs(a) > 0.5 * np.abs(a[: sr // 2]).max()))
            self.assertLessEqual(abs(onset(y) - onset(x)), 24)  # 1 ms
            high = lambda a: (lambda f, p: p[f > 8000].sum() / p.sum())(np.fft.rfftfreq(len(a), 1 / sr),
                                                                        np.abs(np.fft.rfft(a)) ** 2)
            self.assertGreater(high(y), high(x) / 2)  # within 3 dB: no low-pass

    def test_encode_to_a_given_loudness(self):
        """--titles matches a book's older chapters, about -22 LUFS (books#37)."""
        sr = 24_000
        x = (0.05 * np.sin(2 * np.pi * 220 * np.arange(3 * sr) / sr)).astype(np.float32)
        with tempfile.TemporaryDirectory() as d:
            sf.write(f"{d}/in.wav", x, sr)
            encode(f"{d}/in.wav", f"{d}/out.m4a", -22.3)
            self.assertAlmostEqual(loudness(f"{d}/out.m4a")[0], -22.3, delta=0.7)

    def test_trim_keeps_a_little_silence_at_each_end(self):
        sr = 24_000
        x = np.concatenate([np.zeros(sr), 0.5 * np.ones(sr // 2), np.zeros(sr)]).astype(np.float32)
        y = trim(x, sr)
        self.assertEqual(len(y), sr // 2 + 2 * int(0.1 * sr))
        self.assertEqual(len(trim(np.zeros(100, np.float32), sr)), 100)


class Titles(unittest.TestCase):
    def test_spoken_titles(self):
        cases = {
            "Chapter 1: The Cyclone": "Chapter One. The Cyclone.",
            "Introduction": "Introduction.",
            "CHAPTER IV.": "Chapter Four.",
            "Part 1, Chapter 3": "Part One, Chapter Three.",
            "XII": "Chapter Twelve.",
            "12": "Chapter Twelve.",
            "Inferno: Canto XXXIV": "Inferno. Canto Thirty-Four.",
            "Dedication of Part I": "Dedication of Part One.",
            "1. How They Went to the Mountains": "One. How They Went to the Mountains.",
            "Book 6, Chapter 365": "Book Six, Chapter Three Hundred and Sixty-Five.",
            "Chapter 28: Mr. MICAWBER’S GAUNTLET": "Chapter Twenty-Eight. Mr. Micawber’s Gauntlet.",
            "Chapter 5: I Elude My Watch Dog": "Chapter Five. I Elude My Watch Dog.",
            "Chapter 17: “It Is the Child!”": "Chapter Seventeen. “It Is the Child!”",
            "Letter 3: [Written some months after the last]": "Letter Three. Written some months after the last.",
            "Chapter the Last": "Chapter the Last.",
            "": "",
        }
        for title, spoken in cases.items():
            self.assertEqual(spoken_title(title, "en"), spoken)

    def test_every_catalogue_title_is_spoken(self):
        for name in sorted(os.listdir(CATALOG)):
            for ch in json.load(open(os.path.join(CATALOG, name)))["chapters"]:
                spoken = spoken_title(ch["title"], "en")
                with self.subTest(book=name, title=ch["title"]):
                    self.assertEqual(bool(spoken), bool(ch["title"].strip()))
                    self.assertNotRegex(spoken, r"\b(?:Chapter|Book|Part|Act|Scene|Canto) (?:\d+|[IVXLC]+)\b")


class Segments(unittest.TestCase):
    def test_every_catalogue_chapter_splits_into_ordered_sentences(self):
        for name in sorted(os.listdir(CATALOG)):
            for i, ch in enumerate(json.load(open(os.path.join(CATALOG, name)))["chapters"]):
                content = ch["content"]
                if not content.strip():
                    continue
                spans = sentences(content, "en")
                with self.subTest(book=name, chapter=i):
                    self.assertTrue(spans)
                    self.assertTrue(all(s < e for s, e, _ in spans))
                    self.assertTrue(all(a[1] <= b[0] for a, b in zip(spans, spans[1:])))
                    self.assertTrue(spans[-1][2])
                    self.assertEqual(len(utf16(content)), len(content) + 1)

    def test_dialogue_stays_one_sentence(self):
        text = "“Oh dear!” said the Rabbit. Mr. Smith left.\n\nNext."
        self.assertEqual([text[s:e] for s, e, _ in sentences(text, "en")],
                         ["“Oh dear!” said the Rabbit.", "Mr. Smith left.", "Next."])

    def test_an_initial_does_not_end_a_sentence_but_i_does(self):
        # The Wizard of Oz introduction's signature was narrated as "L." + pause + "Frank Baum" (books#33)
        text = "Left out.\n\nL. Frank Baum\nChicago, April, 1900.\n\nIt was I. Then N.B. Go."
        self.assertEqual([text[s:e] for s, e, _ in sentences(text, "en")],
                         ["Left out.", "L. Frank Baum\nChicago, April, 1900.", "It was I.", "Then N.B. Go."])



class Spanish(unittest.TestCase):
    """The Spanish profile (books#56): its sentences and spoken titles."""

    def test_spoken_titles(self):
        cases = {
            "Capítulo 12: Que trata de la aventura": "Capítulo doce. Que trata de la aventura.",
            "Tratado 2: Cómo Lázaro se asentó con un clérigo": "Tratado segundo. Cómo Lázaro se asentó con un clérigo.",
            "Parte 1, Capítulo 3": "Parte primera, Capítulo tercero.",
            "Jornada 3": "Jornada tercera.",
            "XII": "Capítulo doce.",
            "Rima 76": "Rima setenta y seis.",
            "Parte 2, Capítulo 74": "Parte segunda, Capítulo setenta y cuatro.",
            "Capítulo 365": "Capítulo trescientos sesenta y cinco.",
            "Capítulo último": "Capítulo último.",
            "Los Duendes del Cuzco": "Los Duendes del Cuzco.",
        }
        for title, spoken in cases.items():
            self.assertEqual(spoken_title(title, "es"), spoken)

    def test_sentences(self):
        text = ("—¿Venta es ésta? —replicó don Quijote. Sr. D. Pedro llegó con Vd. y la Sra. Dña. Inés. "
                "¡Ay! ¿Quién es?\n\n--Cállate, mala lengua. --Iré --dijo él. «Tengo que hablar contigo». Luego.")
        self.assertEqual([text[s:e] for s, e, _ in sentences(text, "es")],
                         ["—¿Venta es ésta? —replicó don Quijote.", "Sr. D. Pedro llegó con Vd. y la Sra. Dña. Inés.",
                          "¡Ay!", "¿Quién es?", "--Cállate, mala lengua.", "--Iré --dijo él.",
                          "«Tengo que hablar contigo».", "Luego."])


if __name__ == "__main__":
    sys.exit(unittest.main())
