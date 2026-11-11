"""English (books#56). The catalogue was built with these rules before profiles existed, so a change
here can re-split published books: run `fetch.py CACHE_DIR --check` over the whole catalogue."""
import re

# ── Headings (fetch.py) ──

KIND = r"(?:CHAPTER|Chapter|BOOK|Book|PART|Part|VOLUME|Volume|STAVE|Stave|LETTER|Letter|ACT|Act|SCENE|Scene|CANTO|Canto|ADVENTURE|EPISODE|Episode|SECTION|Section)"
NUMTOK = r"(?:[IVXLCDM]+|\d+|[A-Za-z]+(?:[- ][A-Za-z]+)?)"
SEP = r"(?:\s*[.:—–-]\s*|\s+)"
SPECIAL = r"(?:THE\s+)?(?:PROLOGUE|EPILOGUE|Prologue|Epilogue|CONCLUSION|Conclusion|PREFACE|Preface|INTRODUCTION|Introduction|AFTERWORD|POSTSCRIPT|FINALE|Finale|PRELUDE|Prelude)"
GENERIC = [  # (level, regex): 0 = book/part/act, 1 = chapter/scene, 2 = bare numeral
    (None, rf"(?P<kind>{KIND})\.?\s+(?:THE\s+|the\s+)?(?P<num>{NUMTOK})\b\.?(?:{SEP}(?P<rest>.*))?"),
    (0, r"(?:THE\s+)?(?P<num>FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+(?P<kind>PART|BOOK|ACT)\.?(?:" + SEP + r"(?P<rest>.*))?"),
    (2, rf"(?P<num>[IVX]|[IVXLC]{{2,}})\.?(?:{SEP}(?P<rest>[A-Z“‘\"'].*))?"),
    (1, rf"(?P<kind>{SPECIAL})\.?(?:{SEP}(?P<rest>.*))?"),
]
MAJOR = {"book", "part", "volume", "act"}  # kinds at level 0
ARTICLE = r"(?:THE|The)\s+"  # dropped from a named heading ("THE PROLOGUE" -> "Prologue")
LAST = ("LAST", "the Last")  # a heading's number word for its last, and how the title says it
LABEL = "Chapter"  # a bare numeral heading's name, unless the book sets `label`
PART = "Part"  # the parts of a text without headings
BACK_MATTER = r"(?i:footnotes?:?|notes:?|notes to the \w+ volume|endnotes|index|glossary|transcriber.*|appendix.*|the end\.?|finis\.?)"
EDITORIAL = r".*\b(?:[Tt]ranslator|[Ee]ditor|[Tt]ranscriber)\b.*|(?:Introduction|Preface|Foreword).*\b[Bb]y [A-Z].*"
# A heading's title wrapped onto the lines below it is joined. Off for English: its books were
# split before this, so nine have such titles cut at the line end (Moby-Dick, Little Dorrit...)
# and fixing them changes their narrated title clips.
WRAPPED_TITLES = False
# A block of lines that mostly stop short of the wrap width is verse when fewer than this share of
# them start in lowercase: English verse capitalises each line
VERSE_LOWER = 0.2
CONTENTS = r"(?:TABLE OF )?CONTENTS?[.:]?|Contents[.:]?"  # a contents list's heading
BYLINE = r"[Bb]y (?:[A-Z][\w.’'-]*\s?){1,5}"
MARKUP = None  # editorial markup in this language's transcriptions, beyond the generic [Illustration] etc.

WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
         "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
         "nineteen", "twenty"]
ORDINALS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
            "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth",
            "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"]
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
        "eighty": 80, "ninety": 90}
TENS_ORD = {"twentieth": 20, "thirtieth": 30, "fortieth": 40, "fiftieth": 50, "sixtieth": 60}


def number_word(t: str) -> int | None:
    """A lowercased number word in a heading: 'fourteen', 'fourteenth', 'twenty-one' -> 14, 14, 21."""
    for table in (WORDS, ORDINALS):
        if t in table:
            return table.index(t)
    m = re.fullmatch(r"(\w+)[- ](\w+)", t)
    if m and m[1] in TENS:
        unit = m[2]
        for table in (WORDS, ORDINALS):
            if unit in table and 0 < table.index(unit) < 10:
                return TENS[m[1]] + table.index(unit)
    return TENS.get(t) or TENS_ORD.get(t)


# Title case of ALL-CAPS headings: these words stay lowercase after the first, these all-caps
# words are not Roman numerals, and a capital follows these openers
SMALL = {"a", "an", "the", "and", "but", "or", "nor", "of", "in", "on", "at", "to", "by", "for",
         "with", "from", "as", "into", "upon", "de", "la", "le", "du", "von", "van"}
NOT_ROMAN = ("I", "LIVE")
OPENERS = "\"“‘'(\\["

# ── Sentences (segments.py) ──

END = re.compile(r"[.!?…]+[”’\"')\]]*(?=\s+(?![a-z]))")
# A capital letter alone is an initial, except the pronoun I ("It was I.")
ABBREVIATION = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Rev|Capt|Col|Gen|Lt|Mt|[A-HJ-Z])$")

# ── Spoken titles (segments.py) ──

SPOKEN_KIND = r"(?:Chapter|Book|Part|Volume|Stave|Letter|Act|Scene|Canto|Adventure|Episode|Section|Epilogue|Fable)"
ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
        "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
TENS_WORDS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def words(n: int) -> str:
    """12 -> "Twelve", 365 -> "Three Hundred and Sixty-Five" (below 10,000)."""
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS_WORDS[n // 10] + (f"-{ONES[n % 10]}" if n % 10 else "")
    big, unit = (1000, "Thousand") if n >= 1000 else (100, "Hundred")
    rest = n % big
    return f"{words(n // big)} {unit}" + ("" if not rest else f" and {words(rest)}" if rest < 100 else f" {words(rest)}")


def spoken_number(kind: str, n: int) -> str:
    """How n is said after the heading word kind ("" for a numeral alone): "Chapter Twelve"."""
    return words(n)
