"""Language profiles (books#56): what the catalogue and narration pipelines need to know about the
language a book is written in. A book's `language` (its BCP 47 tag, `en`, `es`...) picks the module
named after the tag's language subtag. How to write one: docs/catalogue-pipeline.md.

fetch.py and segments.py keep the parts that don't depend on the language (Gutenberg markers,
paragraph and verse logic, the lock) and take these from the profile:

- headings: GENERIC (level, regex) patterns, KIND, MAJOR, SPECIAL, number_word(), the default
  LABEL of a bare numeral, PART for a text split without headings, LAST ("Chapter the Last");
- title case: SMALL words, NOT_ROMAN capitals, OPENERS before a capital;
- front and back matter: EDITORIAL, BACK_MATTER, CONTENTS, BYLINE, MARKUP;
- sentences: END and ABBREVIATION;
- spoken titles: SPOKEN_KIND and spoken_number().
"""
import importlib


def profile(lang: str):
    """The profile module for a BCP 47 tag ("es", "en-GB" -> en)."""
    return importlib.import_module(f"{__name__}.{lang.split('-')[0].lower()}")
