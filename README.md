# Libros

Clásicos de la literatura en español para leer y escuchar, gratis y sin registro. Novela, teatro,
poesía y ensayo de España y América, con audiolibros narrados en algunos títulos y lectura sin conexión.

**Categoría:** Learning
**En línea:** [libros.freeappstore.online](https://libros.freeappstore.online)

## Development

Libros is the Spanish edition of [Books](https://github.com/freeappstore-online/books): a fork that keeps
its own `edition/` (books, texts, covers, config) and takes everything else from Books.

- Change the app itself (reader, player, pipeline) in **books**, never here. Its `Sync with books`
  workflow brings the change in, and `Engine unchanged` fails a push that edits engine files here
  (`docs/editions.md`).
- Add or change books here, in `edition/`, as described in `docs/adding-books.md`.
- How this app was made and how to keep it in sync: `docs/new-language-app.md`.

```bash
pnpm install
pnpm dev
```

## License

MIT
