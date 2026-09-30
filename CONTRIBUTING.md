# Contributing

Work in `MintRadar/` (frontend) and `MintRadar/backend/` — not the git root. The root only holds README, LICENSE, SECURITY.md, and this file.

## Tests

```bash
cd MintRadar
npx vitest run          # frontend

cd MintRadar/backend
npx vitest run          # backend
```

Do not run a bare `npx vitest` from the repo root; that pulls the wrong package.

## PRs

- Open an issue before a non-trivial change.
- Prefer issues labeled **good first issue**.
- Keep secrets out of the tree (`.env.example` placeholders only).
- Match existing code style; do not reformat unrelated files.

By contributing you agree the work is licensed under MIT, same as the repo.
