# MintRadar — Claude Code Context

> Detailed sections of this file live in `docs/claude/` (see the index below). Read the matching file BEFORE working in that area. Pointers are plain text on purpose — do not `@`-import them.

## Index — when you work on X, read docs/claude/Y.md first

| When you work on… | Read first |
|---|---|
| Writing code that fetches URLs, handles user input, authentication, headers or CSP | `docs/claude/backend-api-and-data.md` and `docs/claude/deploy-and-infra.md` |
| Backend `/api/*` endpoints, DB schema/tables, rate limits, cron jobs, notifications, NIP-98 auth | `docs/claude/backend-api-and-data.md` |
| Reliability Score, `prober.ts`, degraded/offline detection, NUT list / NUT tracking scope, score donut arc, Reliability vs Community Rating | `docs/claude/scoring-and-probing.md` |
| Mint discovery pipeline, relay lists, test-mint detection, "Most Reliable" panel, recommendation age gate | `docs/claude/discovery-and-relays.md` |
| Deploy pipeline, GitHub Actions, nginx/CSP/headers, service worker/PWA, OG tags, bundle/chunk-load recovery, dependency versions, backups | `docs/claude/deploy-and-infra.md` |
| `MintCard`, card badges, Mint Detail (sidebar, Keysets, Version History, route canonicalization), `mintFormatting.ts` helpers | `docs/claude/card-and-mint-detail-ui.md` |
| Dashboard filters/default view, Watchlist UI, Compare feature, Stats page layout | `docs/claude/stats-dashboard-watchlist-ui.md` |
| Colors and tokens (`--copper`, `--bg`, palette), typography, `--dash-chrome-max` page width, **badge/chip text must reach 4.5:1 (derive tones with color-mix from tokens)** | `docs/claude/design-palette-and-chrome.md` |
| Tools page, Best Mint Wizard, Token Inspector | `docs/claude/tools-page.md` |
| The `/methodology` and `/for-wallets` pages, `METHODOLOGY_VERSION` / `METHODOLOGY_CHANGES`, `WALLET_MINT_FIELDS`, the sitemap, footer links | `docs/claude/methodology-and-wallet-pages.md` |
| Reviews (kind:38000), `mint_reviews` sync, `sharedPool` | `docs/claude/reviews-and-nostr.md` |
| Signed mint health assertions (Nostr kind 30385, `healthAssertions.ts`/`healthPublisher.ts`, `ATTESTATION_SERVICE_NSEC`, the own-relay allow-list `privileged-pubkeys.txt`) | `docs/claude/nostr-health-assertions.md` |
| What the browser contacts outside our origin (relays, mints, NIP-05 hosts, avatars, QR), Best Mint wizard direct fetches | `docs/claude/third-party-requests.md` |
| Mobile layout, navbar, overflow fixes, tooltips, chart focus ring, **modal dialogs (`useModalFocus`, role/aria-modal/name, focus trap/restore)** | `docs/claude/mobile-and-tooltips.md` |
| Writing or changing an **e2e spec** (`e2e/`): waits, held mocks, the settle helpers, the permanent contract specs, allow-lists, tooltip expected counts, known application findings | `docs/claude/e2e-conventions.md` |
| The `/about` page (privacy notice, rules): what it claims and the source of every claim; **update `About.tsx` when provider backups/snapshots, log fields or retention, the backup script, the relay write policy, notification storage, a new browser request or `PROBE_LOCATION` change** | `docs/claude/privacy-and-about.md` |
| What is planned after the public announcement: week-by-week backlog, "only on feedback" items, fixed future dates | `docs/claude/post-announcement-backlog.md` |
| Security audit history, hardening rationale, external reviews, ESLint cleanup | `docs/claude/security-audit-and-reviews-history.md` |

## Project
Privacy-first Cashu mint monitoring PWA.
Live: https://mintradar.org
GitHub: https://github.com/hroomnik007/MintRadar

## Server
Sensitive values are in CLAUDE.local.md (gitignored) — ask the developer

- VPS: $VPS_HOST, user: $VPS_USER
- Frontend: $VPS_DIST_PATH (served by Nginx)
- Repo: $VPS_REPO_PATH
- Backend: Node/Express, port $BACKEND_PORT, Docker
- DB: PostgreSQL in Docker ($DB_NAME, user: $DB_USER)

## Stack
- Frontend: React 19 + TypeScript + Vite 8 + TanStack Query v5 + Zustand + Dexie (IndexedDB) + Recharts + vite-plugin-pwa
- Backend: Node.js 22 + Express 5 + TypeScript + pg (PostgreSQL 17) + nostr-tools
- Auth: Nostr NIP-07 (nos2x-fox, Alby) + nsec manual entry (key held in memory for the session to enable signing, zeroed on logout — see Nostr Login below) + NIP-46 bunker (implemented, nostr-tools/nip46 BunkerSigner)
- Fonts and CSS: DM Sans + JetBrains Mono (self-hosted), CSS variables with the "patina/copper" palette; hex values and tokens: `docs/claude/design-palette-and-chrome.md`.

## Architecture
- Watchlist: IndexedDB only (never on the server). Public mint history: PostgreSQL. `/api/*` is proxied by Nginx to the backend.
- Cron every 5 min probes `/v1/info`: a mint is ONLINE only on a 2xx (`res.ok`) with valid JSON whose `nuts` is an object (`backend/src/prober.ts`).
- Notifications: sent only by the server (NIP-17 DMs); the browser never publishes DMs. Reviews: NIP-87 kind:38000, read/written by the browser. Details: Index table.

## Hard invariants (lifted verbatim from docs/claude files — they stay in core on purpose)

- Icon proxy `GET /api/mint/icon`: every mint `<img>` goes through it (never a mint-supplied `icon_url`); known mints only, `safeFetch`, raster only, any failure → 204. Details: `docs/claude/backend-api-and-data.md` ("Icon proxy", "GET /api/mint/icon").
- Outbound API calls use `safeFetch`. The root `SimplePool` in `discovery.ts` / `reviewsSync.ts` is NOT DNS-pinned (safe only because its relay lists are hardcoded; a dynamic list must use `DnsPinnedWebSocket`). Details: `docs/claude/discovery-and-relays.md` ("Discovery pipeline").
## Relay lists and mint icons
- Relay lists live in 4 places and must be changed together: frontend `DISCOVERY_RELAYS` + `PROFILE_RELAYS` (`src/core/nostr/relays.ts`), backend `DISCOVERY_RELAYS` (`discovery.ts`), backend `NOSTR_REVIEWS_RELAYS` (`index.ts`); the backend cannot import the frontend file. Details: `docs/claude/discovery-and-relays.md`.
- Token Inspector shows a mint icon only for tracked mints; never build an icon URL from a token. Details: `docs/claude/tools-page.md` ("Token Inspector").

## Key features
Pages: Dashboard (mint grid, filters, sort), Mint Detail, Compare (up to 4 mints), Stats, Tools (Best Mint Wizard, Token Inspector), Watchlist (Nostr login), For wallets (API), Methodology (scoring), Learn (5 modules), About. Details: Index table above.

## Deploy workflow
Deploys run in CI (`.github/workflows/deploy.yml`): a push to `main` first runs the backend and frontend unit tests (`test` job), then the `deploy` job (`needs: test`) updates the server checkout, rebuilds the backend image (`docker compose build --pull backend` + `up -d`), builds the frontend and copies `dist/` to the web root. There is no manual rsync or SSH step.
Commit with the "Git rules" below, then `git push origin main && git push gitea main` and check the CI result. Details, nginx (applied by hand) and server notes: `docs/claude/deploy-and-infra.md`.

## Git rules (several sessions can touch this checkout)

Another session once committed in this checkout between my steps and swept up my staged `git rm` of a hook while `Dashboard.tsx` still imported it; that commit went to `main` and turned Deploy red. These rules prevent that.

- **Never `git add -A` and never `git commit -a`.** Stage only the files you changed: `git add <paths>`.
- **Before every task** print `git status`, `git stash list` and `git log --oneline -5`. If there are uncommitted changes you did not make: stop and ask.
- **Before every commit** run `git status` and `git diff --cached --stat`. If a file you did not touch is staged: stop and ask.
- **Do not run two sessions in the same checkout at the same time.**
- **If you must change a file another session has modified** (`git diff` shows changes you did not make), stage only your own hunks with `git add -p` and say so in your report.
- **After every push** check the CI result for your commit (`gh run list --limit 3`) and report it first.
- **Remotes: `origin` (GitHub) is the source of truth; local `main` tracks `origin/main`.** Push with one command from one sha: `git push origin main && git push gitea main`. **NEVER `git pull`, `git rebase` or `git merge` from gitea.** If the push to gitea is rejected or the host is unreachable: report it and STOP (no rebase, merge or force). Realigning a diverged gitea: see `docs/claude/deploy-and-infra.md` ("Gitea remote").

## Nostr Login
Three methods (NIP-07, nsec, Amber/NIP-46 bunker) in the login modal of `AppShell.tsx`; implementation details: `docs/claude/reviews-and-nostr.md` ("Login methods").
- **nsec is held in memory only** (`activeNsecPrivkey`), never written to any storage API, zeroed on logout. It does not survive a reload.
- Remote-signer (`onauth`) URLs are opened only as `https://` with `noopener,noreferrer` (`openRemoteSignerAuthUrl()`), and a cancelled `initBunkerQR` pairing must commit no state. History and reasoning: `docs/claude/security-audit-and-reviews-history.md` ("Nostr Login: 2026-09-07 audit fixes").

`sessionStorage` (Zustand persist) stores only the public `NostrProfile` `{ pubkey, npub, name, picture }` — no private key material is ever written to any storage API. For nsec logins the raw key is held in JS memory only (see above), which is a deliberate trade-off (enables signing) — do not add any persistence for it without re-confirming with the maintainer, since that would defeat the "in-memory only, lost on reload" guarantee.

## Watchlist Persistence
**Rule:** Logout MUST call `resetInMemory()`, NOT `clearWatchlist()`; Dexie must survive logout (a cleared Dexie plus an empty relay answer would lose the watchlist for good). Why and implementation: `docs/claude/stats-dashboard-watchlist-ui.md` ("Watchlist Persistence").

## Testing Infrastructure

### Test suites

No test counts are kept in this file (they drift). Each suite prints its current number when it runs:

| Suite | Tool | Location | Current count |
|-------|------|----------|---------------|
| Backend (unit + integration + security) | Vitest | `backend/src/__tests__/` (incl. `integration/`, `security/`) | `(cd backend && npm test)` prints "Test Files" and "Tests" |
| Frontend unit | Vitest | `src/__tests__/` | `npm test` prints "Test Files" and "Tests" |
| E2E | Playwright | `e2e/` | `npx playwright test --list` prints the number of tests and spec files; known skips are marked in the specs |

### Run commands

Run from the app directory (the one holding `package.json`, `e2e/` and `backend/`). Each command is self-contained, so the block can be pasted as-is:

```bash
# Backend (unit + integration + security)
(cd backend && npm test)

# Frontend unit
npm test

# Types (src + node + e2e) and lint (src + e2e); the production build does not check e2e
npm run typecheck
npm run lint

# E2E
npm run test:e2e
```

## Verification policy
Pick the tier by the risk of the change; each tier includes the one before it. Backend: its own lint, typecheck and build.
- **Tier 1, small changes** (documentation, comments, texts, CSS of a single page, e2e-only changes): `npm run typecheck`, `npm run lint`, a production build, and ONLY the targeted specs of the touched area. No full unit suites needed locally (CI runs them before the deploy). No full e2e. Docs-only changes need no suites at all.
- **Tier 2, shared frontend changes** (a component or utility used on several pages, frontend logic): Tier 1 plus the whole backend suite (`cd backend && npm test`) and the whole frontend suite (`npm test`), and the targeted e2e specs of every affected area.
- **Backend-only changes** (`backend/src`, its tests and docs; no API shape, frontend, workflow or build configuration change): backend lint, typecheck, build, the whole backend suite and, when the change touches the database, the backend integration tests against a throwaway Postgres. NOT a full e2e run: e2e mocks the whole API and says nothing about backend code.
- **Tier 3, risky changes** (API shapes, dependency updates including Dependabot bumps, build or router configuration, login and key handling, notifications, anything that touches many pages): Tier 2 plus ONE full e2e run (`npm run test:e2e`) before pushing. A second full run only to investigate flakiness.
- **Milestones:** one full e2e run before announcing the project to others and after a batch of Dependabot updates.
- A task prompt names its tier; if it does not, the task decides by the rules above and says which tier it chose in the report. A full e2e run is never added "just in case" to a Tier 1 or Tier 2 change.
- CI (the `test` job) runs the backend and frontend unit tests before every deploy (the `Unit tests` workflow runs the same two suites on pull requests), and the server runs the production build during the deploy; typecheck and lint are NOT in CI, and e2e is NOT in CI either (a broken e2e spec is only noticed when someone runs it).

## Docs rule
A change to user-visible behaviour, to which hosts the browser or the server contacts, or to what is stored about people or for how long updates the matching `docs/claude/` file in the SAME commit; if a public statement changes, also `About.tsx` and `docs/claude/privacy-and-about.md`.
A change to the Reliability Score formula (component weights, the audit rule, the version rule, the new-mint cap, the recommendation gate) also adds a `METHODOLOGY_CHANGES` entry and bumps `METHODOLOGY_VERSION` in the SAME commit (`backend/src/shared/methodology.ts` and its frontend copy `src/utils/methodology.ts`) and updates the `/methodology` page data (`src/constants/methodologyPage.ts`) — its test fails otherwise; a new field of the wallet API's mint object needs its line in `WALLET_MINT_FIELDS` (`docs/claude/methodology-and-wallet-pages.md`).

**README and CONTRIBUTING (2026-10-20):** the root `README.md` is the only README; `MintRadar/README.md` is a short pointer to it, and the one CONTRIBUTING file is `.github/CONTRIBUTING.md`. A number in the README must be pinned to a code constant in `src/__tests__/readmeFacts.test.ts` (probe minutes, Node/React/Vite/Express majors, the Postgres image, compare limit, Rating formula, ports, event kinds); otherwise generalise it or link to `/methodology`. The test also bans "Trust Score", "good first issue", `npm install` in code blocks and the verdict words trusted/safe/guaranteed, and checks every relative link of the three files. The URL-parameter passage is guarded by `src/__tests__/readmeUrlParams.test.ts` (root README only). Install steps use `npm ci` and were run in a scratch copy before the README was written; the backend must be built (`backend/dist`) before `docker compose up -d`.

## Key rules
- **Before starting ANY new task, check `git branch --show-current`.** If it isn't `main`, find out why (an in-progress PR still awaiting merge vs. a forgotten checkout left over from a prior session) before committing anything. A 2026-08-05 session left a feature branch checked out after its PR had already merged; two unrelated follow-up fixes got committed there instead of on `main` and had to be recovered via a second PR (#54).
- NEVER modify anything not explicitly requested
- A failed API call is never shown as a mint state (offline / unknown / "Not a tracked mint" / zero counts): show `LoadError` (`src/components/LoadError.tsx`, fixed text + Try again) instead; `docs/claude/stats-dashboard-watchlist-ui.md` ("Error states")
- New tooltips use the `InfoTooltip` component (`src/components/InfoTooltip.tsx`) with a label or `about` — never a `title` attribute for an explanation and never a bespoke popup; contract and how to add one: `docs/claude/mobile-and-tooltips.md`
- ALWAYS run typecheck before build — `npm run typecheck` is `tsc -b && npm run typecheck:e2e`: `tsc -b` covers the app (`src`) and node (`vite.config.ts`) projects, `typecheck:e2e` (`tsc -p tsconfig.e2e.json`, same strictness flags as `tsconfig.app.json`, `e2e/**/*.ts`) covers the Playwright specs and fixtures (noEmit, buildinfo gitignored). `npm run lint` is `eslint src e2e`. **`npm run build` (`tsc -b && vite build`) intentionally does NOT check e2e**, and `tsconfig.e2e.json` must never be added to the references in `tsconfig.json`: the server runs `npm run build` during a deploy, after the backend is already live, so a type error in a spec must not be able to fail the frontend step. A spec's types are checked locally (this rule) only. (`npm run typecheck` used to be `tsc --noEmit` on the root tsconfig, which has `files: []` and only references, so it checked 0 files — fixed 2026-10-03; e2e was added 2026-10-05.)
- Never rsync `dist/` by hand: CI deploys on push to `main`
- ALWAYS push to both remotes: `git push origin main && git push gitea main`
- Commit messages: a short imperative sentence. The prefixes the repository actually uses (`fix:`, `style:`, `feat:`, `test:`, `e2e:`, `docs:`, `chore:`) are allowed, not required.
- Node 22 is required (`engines`, `.nvmrc`, Dockerfile, deploy workflow): Node 20 fails the frontend and backend unit suites with `webidl.util.markAsUncloneable is not a function`; `docs/claude/deploy-and-infra.md` ("Dependency policy")
- New dependency: only with a written reason in the commit message, prefer Node/browser APIs and packages already installed, no packages with install scripts; rules, the quarterly audit method and the kept-on-purpose list are in `docs/claude/deploy-and-infra.md` ("Dependency policy")
- Security: always audit new code for SSRF, rate limits, XSS
- Outbound connections to non-hard-coded hosts go through `backend/src/ssrf.ts` (`safeFetch`, `safeLookup`, `DnsPinnedWebSocket`); every nostr-tools pool connects with `RelayWebSocket` (`wsPolyfill.ts`) so a connection error never becomes an uncaughtException; rule table, tests and icon-proxy failure reasons: `docs/claude/backend-api-and-data.md` ("Network layer")
- Security: `verifyEvent()` from nostr-tools must be called on all inbound Nostr events (frontend hooks and backend discovery). Profiles (kind:0) and other replaceable events are used only from the requested author and the NEWEST valid event wins (`src/core/nostr/profileEvents.ts`, `pickNewestProfileEvents` in `backend/src/profilesSync.ts`; follow list: `fetchFollowRecs`); details in `docs/claude/reviews-and-nostr.md` ("Nostr data rule")
