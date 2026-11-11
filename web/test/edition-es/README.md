# The Spanish test edition

The Spanish end-to-end test (`e2e/es/`, the `es` Playwright project) runs the app with an edition whose
language is `es`, to check that nothing in the interface stays in English (books#54). It is the
smallest edition that shows every page: two books copied from `test/edition`, with their texts, covers
and `books.json` entries.

| Book | Why |
|---|---|
| `alice-in-wonderland` | the narrated book: the stubbed narration (`e2e/fixtures.ts`) is its |
| `a-christmas-carol` | a reading-only book |

The book data stays in English: the test looks at the interface, and leaves out what comes from the
books (their metadata and texts). Its `config.json` is a Spanish app's, with the English narration
dataset so the stubs answer. Don't edit copied texts by hand.
