"""The narration engine and its language (books#57): what generate.py speaks with.

Each edition names its engine and voice in edition/config.json (`audio`), and its language there too
(docs/editions.md). The language is never guessed from the voice id. A second engine, for languages
Kokoro has no voice for, plugs in here (books#64).
"""
import json, os

# Kokoro v1.0's languages, as its phonemizer codes (hexgrad/Kokoro-82M VOICES.md)
KOKORO = {"en": "en-us", "es": "es", "fr": "fr-fr", "it": "it", "pt": "pt-br", "hi": "hi", "ja": "ja", "zh": "cmn"}


def edition_config(catalog: str) -> dict:
    """The config of the edition whose texts are in `catalog` (<edition>/texts)."""
    with open(os.path.join(os.path.dirname(os.path.abspath(catalog)), "config.json"), encoding="utf-8") as f:
        return json.load(f)


def language(catalog: str) -> str:
    """The edition's language (BCP 47): what its books are written in."""
    return edition_config(catalog)["language"]


def kokoro_lang(lang: str, voice: str) -> str:
    """Kokoro's code for `lang`; British English for the b* voices, as their names say."""
    base = lang.split("-")[0].lower()
    if base not in KOKORO:
        raise SystemExit(f"Kokoro has no {lang} voice: narrate this edition with another engine (books#64)")
    return "en-gb" if base == "en" and voice.startswith("b") else KOKORO[base]


def check(catalog: str, voice: str) -> str:
    """The engine's language code, or SystemExit when the edition's engine can't narrate its language."""
    config = edition_config(catalog)
    engine = config["audio"]["engine"]
    if engine != "kokoro":
        raise SystemExit(f"unknown narration engine {engine!r} in edition/config.json (books#64)")
    return kokoro_lang(config["language"], voice)


def synthesizer(catalog: str, models: str, voice: str):
    """A function text -> (samples, sample rate) speaking the edition's language in `voice`."""
    lang = check(catalog, voice)
    from kokoro_onnx import Kokoro
    kokoro = Kokoro(f"{models}/kokoro-v1.0.onnx", f"{models}/voices-v1.0.bin")
    return lambda text: kokoro.create(text, voice=voice, speed=1.0, lang=lang)
