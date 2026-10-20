# Contributing to MintRadar

Thanks for taking the time to contribute! MintRadar is privacy-first monitoring
for Cashu ecash mints, used by the Bitcoin/Cashu/Nostr community where
correctness matters. This document explains how to get set up and what we expect
from a contribution.

Be respectful and constructive in issues, pull requests, and discussions.

---

## Before you start

- **For bugs and small fixes** — open an issue (or go straight to a PR for a
  one-line fix).
- **For anything larger** — new features, refactors, dependency changes,
  changes to the Reliability Score formula or the probe logic — **open an issue first**
  so we can agree on the approach before you write code.
- **For security vulnerabilities** — do **not** open a public issue. Follow
  [SECURITY.md](../SECURITY.md) (Nostr DM to the maintainer, or GitHub private
  vulnerability reporting).

---

## Project layout

The application lives in the `MintRadar/` subdirectory of the repo; work there (and in
`MintRadar/backend/`), not in the git root, which only holds the README, LICENSE,
SECURITY.md and repository config:

```
MintRadar/
  src/            React + TypeScript + Vite frontend
  backend/        Node.js + Express + PostgreSQL API
  e2e/            Playwright end-to-end tests
  deploy/         Nginx config
  docker-compose.yml
```

## Local setup

**Prerequisites:** Node.js 22 or newer, Docker + Docker Compose.

Follow [Getting Started](../README.md#-getting-started--self-hosting) in the README to
configure the backend (`backend/.env`, `POSTGRES_PASSWORD`). Then, from `MintRadar/`:

```bash
(cd backend && npm ci && npm run build)   # the backend image is built from backend/dist
docker compose up -d      # starts PostgreSQL + backend API on :3002
npm ci
npm run dev               # frontend on http://localhost:5173
```

Use `npm ci`, not `npm install`: npm 10 rewrites the lockfiles and drops fields that
`npm run lint` checks for.

## Before you push

CI runs the backend and frontend unit test suites on every push to `main`, and a
security workflow on every push and pull request. Typecheck and lint are not in CI, so
run them yourself, together with the tests of the area you touched (run these from
`MintRadar/`; a bare `npx vitest` from the git root pulls the wrong package):

```bash
npm run typecheck                     # app, node and e2e projects
npm run lint                          # eslint on src and e2e, internal link check, lockfile check
npx vitest run src/__tests__/<file>   # the frontend tests of what you touched
(cd backend && npx vitest run)        # backend changes: the backend suite
npm run build                         # production build must succeed
```

For changes that touch UI flows, also run the end-to-end specs of the affected area:

```bash
npm run test:e2e      # playwright (add a spec path to run just one)
```

---

## Pull request guidelines

- **Branch from `main`** and keep PRs focused — one logical change per PR.
- **Write a clear description** — what changed, why, and how you tested it. Fill
  in the PR template.
- **Add or update tests** for any behavior change. Security-relevant code
  (SSRF checks, input validation, key handling, SQL) must have test coverage —
  see `backend/src/__tests__/security/`.
- **Update docs** — if you change setup, features, or the Reliability Score formula,
  update the root `README.md`; the details behind a feature live in `MintRadar/docs/`.
  `README.md` is checked by a test (`src/__tests__/readmeFacts.test.ts`), so a number or
  link in it that no longer matches the code fails the suite.
- **Keep the privacy guarantees intact** — no analytics, no telemetry, no
  third-party scripts, no external font/CDN requests, no sending Nostr private
  keys or watchlist data to the backend. PRs that break these will be rejected.
- **Keep secrets out of the tree** — `.env.example` placeholders only.
- **Match the existing code style**; do not reformat unrelated files.
- **Commit messages** — a short imperative sentence. Prefixes such as `fix:`,
  `feat:`, `test:` or `docs:` are fine but not required.

## Review process

The security workflow must be green and the checks above must pass locally. The
maintainer reviews PRs on a best-effort basis (typically
within about a week). Expect a round or two of feedback on anything non-trivial.

---

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](../LICENSE) that covers this project.
