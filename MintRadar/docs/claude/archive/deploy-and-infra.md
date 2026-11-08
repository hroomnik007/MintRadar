# Archive of deploy-and-infra.md
> History only: sections moved out of `docs/claude/deploy-and-infra.md` because they describe superseded or removed behaviour. Do not read this for current rules.

### vault.ts removed (dead code)

`src/core/crypto/vault.ts` was deleted. It had zero imports across the codebase and contained a broken nsec bech32 decode (`.slice(5)` instead of `nip19.decode`). The entire `src/core/crypto/` directory no longer exists — do not recreate it.

## Dependency versions (as of 2026-06-29)

_Entries for packages removed on 2026-10-14 (`globals`, `@noble/hashes` and `@noble/secp256k1`, the backend's `@typescript-eslint/*`, `@types/node-cron`, `ws` and `@noble/ciphers` in the frontend, `sharp`) are gone from this list; see "Dependency policy" above._

### Frontend
- eslint: 10.6.0 (upgraded from 9.x)
- eslint-plugin-react-hooks: 7.1.1 (upgraded from 5.2.0 — v7 adds ESLint v10 support)
- lucide-react: 1.22.0
- @types/node: 26.0.1
- immer: 11.1.16 (upgraded 2026-08-15 — was held at v10 pending verification with Zustand, now confirmed compatible, see the "GOTCHA — Dependabot PRs" Batch 3 note above)

### Backend
- undici: 8.5.0 (security fix — 8 CVE patched)
- pg: 8.22.0
- node-cron: 4.5.0
- @types/node: 26.0.1
