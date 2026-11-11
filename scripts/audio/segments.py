"""Split a chapter into the sentences that are narrated one at a time (books#18, books#22).

A sentence ends where the language profile's END matches (. ! ? or … with any closing quotes or
brackets, followed by whitespace and not by a lowercase word), so `“Oh dear!” said the Rabbit`
stays one piece, and not after one of its ABBREVIATIONs, a title like Mr. or an initial like the L.
of `L. Frank Baum` (narrated alone, the initial got a sentence's pause after it, books#33). Blank
lines end paragraphs. Offsets are Python string indices; utf16() converts them to JavaScript ones.
spoken_title() is what a chapter's title clip says (books#37). The profiles are in
scripts/catalog/languages (books#56); lang is the book's language.
"""
import os, re, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "catalog"))
from languages import profile  # noqa: E402

PARAGRAPH = re.compile(r"\S.*?(?=\s*\n\s*\n|\s*$)", re.S)


def sentences(content: str, lang: str) -> list[tuple[int, int, bool]]:
    """(start, end, ends_paragraph) of every sentence, in order, trimmed of surrounding space."""
    p = profile(lang)
    out = []
    for para in PARAGRAPH.finditer(content):
        start = para.start()
        for m in p.END.finditer(content, start, para.end()):
            if m.group() == "." and p.ABBREVIATION.search(content, start, m.start()):
                continue
            out.append((start, m.end(), False))
            start = m.end() + len(content[m.end():para.end()]) - len(content[m.end():para.end()].lstrip())
        if start < para.end():
            out.append((start, para.end(), False))
        out[-1] = (out[-1][0], out[-1][1], True)
    return out


def utf16(content: str) -> list[int]:
    """UTF-16 offset of every Python index into content, plus its end."""
    offsets = [0]
    for ch in content:
        offsets.append(offsets[-1] + (2 if ord(ch) > 0xFFFF else 1))
    return offsets


ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def numeral(tok: str) -> int | None:
    """'12' / 'XII' -> 12; anything else None."""
    if tok.isdigit():
        return int(tok)
    if re.fullmatch(r"M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})", tok) and tok:
        return sum(-ROMAN[a] if ROMAN[a] < ROMAN.get(b, 0) else ROMAN[a] for a, b in zip(tok, tok[1:] + " "))
    return None


def spoken_title(title: str, lang: str) -> str:
    """What a chapter's title clip says: "Chapter 1: The Cyclone" -> "Chapter One. The Cyclone.",
    "Part 1, Chapter IV" -> "Part One, Chapter Four.", "XII" -> "Chapter Twelve.", "" -> "";
    in Spanish "Tratado 2: Cómo..." -> "Tratado segundo. Cómo...".

    Numbers after a heading word and numbers standing alone are spelled out, so the roman ones
    aren't read as letters or the pronoun I; ALL-CAPS words are lowered so they aren't spelled.
    """
    p = profile(lang)
    t = re.sub(r"[\[\]_*]", "", title).strip()
    t = re.sub(r"\s+", " ", t)
    if not t:
        return ""
    if numeral(t.rstrip(".")) is not None:  # a chapter called "XII" or "12"
        t = f"{p.LABEL} {t.rstrip('.')}"
    t = re.sub(r"^(\d+|[IVXLC]+)\.\s+(?=\S)", lambda m: f"{m[1]}: ", t)  # "1. How They Went..." -> "1: How..."
    t = re.sub(rf"\b({p.SPOKEN_KIND})\.?\s+(\d+|[IVXLCDM]+)\b\.?(?![’'\w])",
               lambda m: f"{m[1]} {p.spoken_number(m[1], numeral(m[2]))}" if numeral(m[2]) is not None else m[0],
               t, flags=re.I)
    t = re.sub(r"^(\d+|[IVXLC]+)(?=:)", lambda m: p.spoken_number("", numeral(m[1])) if numeral(m[1]) else m[0], t)
    t = re.sub(r"\b[A-Z][A-Z’']+\b", lambda m: m[0] if numeral(m[0]) else m[0].capitalize(), t)
    t = re.sub(r"\s*:\s*", ". ", t)
    t = t[:1].upper() + t[1:]
    return t if re.search(r"[.!?…][”’\"')]*$", t) else t + "."
