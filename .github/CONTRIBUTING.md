# Contributing to MintRadar

Thanks for taking the time to contribute! MintRadar is privacy-first monitoring
for Cashu ecash mints, used by the Bitcoin/Cashu/Nostr community where trust and
correctness matter. This document explains how to get set up and what we expect
from a contribution.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Before you start

- **For bugs and small fixes** — open an issue (or go straight to a PR for a
  one-line fix).
- **For anything larger** — new features, refactors, dependency changes,
  changes to the Trust Score formula or the probe logic — **open an issue first**
  so we can agree on the approach before you write code.
- **For security vulnerabilities** — do **not** open a public issue. Follow
  [SECURITY.md](../SECURITY.md) (Nostr DM to the maintainer, or GitHub private
  vulnerability reporting).

---

## Project layout

The application lives in the `MintRadar/` subdirectory of the repo:

```
MintRadar/
  src/            React 19 + TypeScript + Vite frontend
  backend/        Node.js 22 + Express 5 + PostgreSQL API
  e2e/            Playwright end-to-end tests
  deploy/         Nginx config
  docker-compose.yml
```

## Local setup

**Prerequisites:** Node.js 22, Docker + Docker Compose.

```bash
# from MintRadar/
docker compose up -d      # starts PostgreSQL + backend API on :3002
npm install
npm run dev                # frontend on http://localhost:5173
```

## Before you push

Run the same checks CI runs — a PR that fails these will not be merged:

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint src
npm run test          # vitest — full suite (~275 tests)
npm run build         # production build must succeed
```

For changes that touch UI flows, also run the end-to-end suite:

```bash
npm run test:e2e      # playwright
```

---

## Pull request guidelines

- **Branch from `main`** and keep PRs focused — one logical change per PR.
- **Write a clear description** — what changed, why, and how you tested it. Fill
  in the PR template.
- **Add or update tests** for any behavior change. Security-relevant code
  (SSRF checks, input validation, key handling, SQL) must have test coverage —
  see `backend/src/__tests__/security/`.
- **Update docs** — if you change setup, features, or the Trust Score formula,
  update `README.md` (and `AUDIT.md` for security-relevant changes).
- **Keep the privacy guarantees intact** — no analytics, no telemetry, no
  third-party scripts, no external font/CDN requests, no sending Nostr private
  keys or watchlist data to the backend. PRs that break these will be rejected.
- **Commit messages** — use [Conventional Commits](https://www.conventionalcommits.org/)
  style (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`), matching the existing
  history.

## Review process

CI must be green. The maintainer reviews PRs on a best-effort basis (typically
within about a week). Expect a round or two of feedback on anything non-trivial.

---

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](../LICENSE) that covers this project.
