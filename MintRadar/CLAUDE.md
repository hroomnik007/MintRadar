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
| Reviews (kind:38000), `mint_reviews` sync, `sharedPool` | `docs/claude/reviews-and-nostr.md` |
| Mobile layout, navbar, overflow fixes, tooltips, chart focus ring, **modal dialogs (`useModalFocus`, role/aria-modal/name, focus trap/restore)** | `docs/claude/mobile-and-tooltips.md` |
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
- Fonts: DM Sans (self-hosted variable, weights 100–900), JetBrains Mono (self-hosted; Regular 400, Medium 500, Bold 700)
- CSS: CSS variables — "patina/copper" palette as of 2026-07-24 (var(--bg) #0b1512, var(--surface)/var(--surface-2)/var(--surface-3), var(--green)/var(--green-bright) #45ad8c/#5cc9a3, var(--copper) #d98a5a, var(--amber), var(--red), var(--text)/var(--text-dim)/var(--text-faint)); see "Visual Redesign" section below for details

## Architecture
- Personal watchlist → IndexedDB (never on server); logout calls resetInMemory() — Dexie NOT wiped on logout; see Watchlist Persistence below
- Public mint history → PostgreSQL (mint_history table)
- Mint discovery → NIP-87 kind:38172 server cron every 6h + client-side after Nostr login
- Backend proxy → /api/* proxied by Nginx to localhost:3002
- Cron every 5min → probes all mints via /v1/info → writes to mint_history
- Online status: mint is ONLINE only if /v1/info returns HTTP 200 with valid JSON containing `nuts` field
- Nostr DM notifications → browser-side via NIP-07 when watchlist mint goes down/up
- Reviews → NIP-87 kind:38000 events, read/write directly from browser via Nostr relays

## Hard invariants (lifted verbatim from docs/claude files — they stay in core on purpose)

<!-- from docs/claude/backend-api-and-data.md — Backend API (/api/mint/icon) -->
- GET /api/mint/icon?url= — SSRF-safe favicon proxy (`backend/src/mintIcon.ts`). `MintFavicon` points every mint `<img>` here instead of fetching the mint-supplied `icon_url` directly — a hostile `icon_url` in a mint's `/v1/info` would otherwise turn every page view into an IP/User-Agent tracking beacon to a host the operator picks (2026-09-07 security audit). Resolves `icon_url` from the DB for a **known mint only** (never proxies an arbitrary caller URL), fetches it via `safeFetch` (SSRF guard + DNS pinning), re-serves the bytes from our origin. Raster + `.ico` only, `Content-Type` allow-list, in-process cache (6h positive / **24h negative**, raised 2026-09-20 from 30min — upstream hit ≤ once/mint/TTL). Anything unsafe/unfetchable → 404 + the client shows its bundled SVG placeholder. `Cache-Control: public, max-age=86400`; `CSP: default-src 'none'; sandbox` + `Cross-Origin-Resource-Policy: same-origin` on the response. Exempt from the per-IP rate limit. **Client-side failure memoization (2026-09-20):** `MintFavicon.tsx` also consults `src/utils/mintIconFailureCache.ts` (localStorage-backed, 24h TTL, keyed by mint url) before rendering `<img>` — a mint whose icon recently `onError`'d skips straight to the monogram placeholder on the next mount (e.g. the grid remounting cards on a sort/filter change) instead of re-requesting the proxy every time. Complements, doesn't replace, the server-side negative cache above.
<!-- from docs/claude/discovery-and-relays.md — Discovery pipeline (safeFetch) -->
**`safeFetch` for outbound API calls (2026-09-07 audit, commit `11c30f1`):** `discovery.ts` (audit.8333.space `/mints/` + `/swaps/mint/{id}`) and `versionCatalog.ts` (`api.github.com/.../releases/latest`) used plain `fetch()` — no connect-time DNS pinning, and undici auto-follows up to 20 redirect hops. Both now call `safeFetch()` (`isSafeUrl()` pre-check + `safeAgent` DNS pinning rejecting private/loopback/link-local/CGNAT at connect + manual redirect following, max 3, each hop re-validated + `credentials: 'omit'`). `SafeFetchOptions` gained an optional `headers` (GitHub Accept header). `safeFetch` returns `Response | null` and never throws, so the "keep last known value" behaviour is preserved. Defence-in-depth — the hostnames are hardcoded constants. **Note:** the root `nostr-tools` `SimplePool` used by `discovery.ts` / `reviewsSync.ts` is NOT the DNS-pinned pool `nostrService.ts` uses — it is only safe because its relay lists are hardcoded; a future dynamic relay list must switch to `DnsPinnedWebSocket` or it becomes SSRF (commented at both sites, `3c8867f`).
<!-- from docs/claude/discovery-and-relays.md — Discovery relays (manual sync) -->
## Discovery relays (backend + frontend) — unified 2026-07-24
Frontend source of truth: `src/core/nostr/relays.ts` (`DISCOVERY_RELAYS`), imported by
`src/core/nostr/mintDiscovery.ts` and `src/hooks/useNostrDiscovery.ts`. Backend can't import
this (separate npm package, no workspace set up) — `backend/src/discovery.ts` keeps its own
`DISCOVERY_RELAYS` constant manually in sync; mirror any change to both.

<!-- from docs/claude/discovery-and-relays.md — Discovery relays (4 relay-list locations) -->
- All 4 relay-list locations kept in sync: frontend `DISCOVERY_RELAYS` + `PROFILE_RELAYS`
  (`src/core/nostr/relays.ts`), backend `DISCOVERY_RELAYS` (`discovery.ts`), backend
  `NOSTR_REVIEWS_RELAYS` (`index.ts`).
<!-- from docs/claude/tools-page.md — Token Inspector (no third-party icon fetch) -->
- **Mint icon (icon only for tracked mints, no third-party icon fetch)** — the MINT cell shows a
  `MintFavicon` tile (36px desktop / 32px mobile, `.trc-mint-icon`) left of name + hostname, ONLY when
  the token's mint is in the known-mints list (`mintInfo`); it uses the same component and
  `/api/mint/icon` backend proxy as the Dashboard, with the initials tile when the mint has no icon.
  For an untracked mint the token's mint URL is chosen by whoever made the token, so NO icon element
  is rendered and nothing is requested for it — never build an icon URL from the token. Covered by

## Key features
- Dashboard: compact/expanded card view, filter panel (**Status + Min. Reliability Score + Hide test mints** — the "Mint age" Fresh/Established/Veteran/OG block was removed 2026-09-08, and the Capabilities Restore/Bolt12/LN group was removed 2026-09-10, see "Dashboard default view + Capabilities filters removed" below; `requiredNuts` state still exists but URL-only, no panel UI), search, sort (default **Reliability Score desc**, "Most reviewed" before Rating; see "Dashboard controls row" and "Dashboard default view" below), mint comparison tool (up to 4, see "Compare feature" above), stats bar, submit form (single + bulk). One-line explainer above the grid (`.grid-score-explainer`): **"We score how it runs. They score how it went. You pick."** (13.5px / `--t2`).
- Mint Detail: MOTD, NUT compatibility grid with modal, NUT limits (NUT-04/05), a **Keysets panel** (desktop: Overview sidebar; mobile: NUTs tab — see "Mint Detail Keysets panel" below), historical charts (24h/7d/30d/90d, Latency/Uptime/Reliability), Mint History panel, version history (real 3-column table — see below), Reliability Score gauge with breakdown, Audit stats, Add to Wallet + QR, NIP-87 reviews, backup checker (NUT-13). Header carries an inline **Online/Offline** pill next to the name, a **New** badge (< 30d), **First seen by MintRadar `<Mon YYYY>`** on the URL row (`firstSeenLabel()`), and a **`Tor`** label prefixing any `.onion` URL. Route param is canonicalized — see "Mint Detail route param canonicalization" below.
- Stats page: totalMints/onlineMints/offlineMints/avgReliabilityScore/avgLatency cards, NUT adoption horizontal bars, Reliability Score donut chart, Most Reliable / Top Reliability widget, Reliability Score Movers, Network Health Index, Geographic Distribution, Software in Use. See "Stats widgets (2026-09-08)" below for the recent changes (test-mint exclusion, CDN bucket, software copy, subtitle omission).
- Watchlist: IndexedDB + optional NIP-44 kind:10003 sync, Nostr login required, no JSON/CSV export, DMs via POST /api/notifications/subscribe (tab can be closed; opt-in per mint, a pill is on only after the server confirmed it — see docs/claude/stats-dashboard-watchlist-ui.md), mint comparison tool (added 2026-09-19 — see "Compare feature" above, `?compare=` URL persistence)
- Wallets: curated list, `src/constants/wallets.ts`. Main grid = 8 end-user wallets (Minibits, Nutstash, Macadamia, Sovran, Cashu.me, Agicash, Coinos, Zeus). **Nutshell** carries `selfHost: true` and renders in a separate **"Run your own mint"** subsection below the grid (2026-09-08 — it's the reference implementation, not a consumer wallet). Card head: platform icon on the left + `.wallet-platform-tag` chips on the right only (the duplicate standalone platform word was removed). `Agicash` was renamed from `Boardwalk Cash`; `eNuts` was removed. No documented inclusion criteria beyond maintainer judgment.
- Nostr: NIP-07 login, profile fetch (kind:0), reviews (kind:38000), DM notifications (kind:4), watchlist sync (NIP-44 kind:10003)
- Learn: educational modules under `src/pages/learn/` (`LearnModule.tsx` router, `LEARN_MODULES` metadata). Slugs: `cashu-basics`, `understanding-the-risks`, `how-to-choose-a-mint`, `getting-started-with-a-wallet`, `safe-habits`. **`/learn/1`…`/learn/5` `<Navigate replace>` to the slug** (matched by `.order`); any other number or unknown slug → "Module not found". Footer nav: `← Previous`, `Next: {title}` for middle modules, **"Browse mints" → `/`** on the last module; "← Back to Learn" kept. Module 4/5 also carry their own in-content CTA `Link` (Module 4 → `/wallets`, Module 5 → `/watchlist`).

## Deploy workflow (ALWAYS do all steps)
See CLAUDE.local.md for $VPS_HOST, $VPS_USER, $VPS_REPO_PATH, $VPS_DIST_PATH values.

Backend (only if backend changed):
1. Commit + push local changes: git add -A && git commit -m "..." && git push origin main
2. On server pull + build: ssh $VPS_USER@$VPS_HOST "cd $VPS_REPO_PATH && git pull origin main && cd backend && npm run build"
3. Rebuild + restart Docker image: ssh $VPS_USER@$VPS_HOST "cd $VPS_REPO_PATH && docker compose build backend && docker compose up -d backend"
   NOTE: `docker compose restart` does NOT pick up code changes — always use `build` + `up -d`

Frontend:
4. Build frontend: npm run typecheck && npm run build
5. Deploy: rsync -avz --delete dist/ $VPS_USER@$VPS_HOST:$VPS_DIST_PATH/
6. Reload nginx: ssh $VPS_USER@$VPS_HOST "sudo systemctl reload nginx"
7. Commit: git add -A && git commit -m "type: description" && git push origin main

## Nostr Login

Login modal (`src/components/layout/AppShell.tsx`) supports three methods selectable via radio cards:
- **NIP-07** — calls `window.nostr.getPublicKey()`; all signing stays in the extension
- **nsec** — decoded in `src/core/nostr/client.ts:loginWithNsec`, then held in a module-scoped variable (`activeNsecPrivkey`) for the session via `installNsecShim()` so the app can sign on the user's behalf (notifications, watchlist sync, reviews) — mirrors `installBunkerShim()`'s pattern. **Never written to any storage API** (sessionStorage/localStorage/IndexedDB) — in-memory only, so it does not survive a page reload. Zeroed via `.fill(0)` and cleared on logout by `removeNsecShim()` (called from `useAuthStore.logout()`, alongside `removeBunkerShim()`). The login modal explicitly discloses this to the user (nsec security notice box + footer line in `AppShell.tsx`).
- **Amber / NIP-46 bunker** — fully implemented via `nostr-tools/nip46` `BunkerSigner`; accepts `bunker://` URI or NIP-05 identifier; QR pairing flow for mobile Amber; session persisted in `sessionStorage` (`bunkerURI`, `bunkerClientSecretKey`, `bunkerPubkey`); 30s connection timeout; client keypair is ephemeral (NOT the user's identity key)
  - **`openRemoteSignerAuthUrl()` (2026-09-07 audit L3, commit `ac7c174`)** — NIP-46 `onauth` used to open the remote-signer-supplied URL with a bare `window.open(url, '_blank')`; a malicious bunker could return a phishing / `javascript:` / `data:` URL or reverse-tabnab via `window.opener`. The helper opens only `https://` URLs, always with `noopener,noreferrer`; non-string / other schemes are ignored with a warning. Wired into all 3 onauth sites (`loginWithBunker`, `initBunkerQR`, `restoreBunkerSession`).
  - **`initBunkerQR` cancel race (2026-09-07 audit L2, commit `0a0cdd0`)** — its `Promise.race([rawSigner, timeout]).then(...)` success path installed the `window.nostr` shim + wrote the bunker credentials with no check that the pairing was still wanted, so a Cancel/close landing in the same tick the connect-ack resolved left a live signer that silently re-logged the user in on the next load. The `.then` now bails on `abortCtrl.signal.aborted` (re-checked after each await): `signer.close()`, pool disposed, reject with `AbortError`, **no** state committed.

`sessionStorage` (Zustand persist) stores only the public `NostrProfile` `{ pubkey, npub, name, picture }` — no private key material is ever written to any storage API. For nsec logins the raw key is held in JS memory only (see above), which is a deliberate trade-off (enables signing) — do not add any persistence for it without re-confirming with the maintainer, since that would defeat the "in-memory only, lost on reload" guarantee.

## Watchlist Persistence

**Rule:** Logout MUST call `resetInMemory()`, NOT `clearWatchlist()`. Dexie must survive logout.

**Why:** `fetchRemoteWatchlist()` returns `[]` when `window.nostr?.nip44` is unavailable (nsec login, older extensions, relay timeout). If Dexie was cleared on logout and the relay returns empty, the watchlist is permanently lost.

**Implementation:**
- Dexie `meta` table (version 2): stores `{ key: 'watchlistOwner', value: pubkeyHex }` after every successful sync
- `useWatchlistSync` Phase 1: reads `watchlistOwner` before fetching remote
  - Same pubkey → Dexie preserved as fallback if remote returns `[]`
  - Different pubkey → Dexie cleared (different user on same device), then load from remote
- `handleLogout` in `AppShell.tsx` calls `resetInMemory()` (in-memory Zustand reset only)

## Testing Infrastructure

### Test counts (as of 2026-09-08): ~966 total

| Suite | Count | Tool | Location |
|-------|-------|------|----------|
| Backend unit | ~306 | Vitest | `backend/src/__tests__/` (excl. subdirs) |
| Frontend unit | 313 | Vitest | `MintRadar/src/__tests__/` |
| API integration | 115 | Vitest | `backend/src/__tests__/integration/` |
| Security | 40 | Vitest | `backend/src/__tests__/security/` |
| E2E | 192 | Playwright | `MintRadar/e2e/` (39 spec files) |

`cd backend && npm test` runs all backend suites together and reports **461**
(306 unit + 115 integration + 40 security). Counts drift often — treat as approximate.

### Key tested modules

- **Backend:** `normalizeUrl`, Reliability Score calculation (prober.ts), degraded/offline detection logic, review parsing (kind:38000 regex), SSRF guard (`backend/src/ssrf.ts`) — DNS rebinding, private ranges, link-local
- **Frontend:** `mintFormatting` and `reviewUtils` (extracted from components into `src/utils/` for testability), Reliability Score display helpers. `mintFormatting.test.ts`'s `mintAgeBadge` Fresh/Established color assertions were updated 2026-07-24 to the new redesign hex values (`#d3a446`/`#5cc9a3`) — see "Visual Redesign" section.

### Run commands

Run from the app directory (the one holding `package.json`, `e2e/` and `backend/`). Each command is self-contained, so the block can be pasted as-is:

```bash
# Backend (unit + integration + security)
(cd backend && npm test)

# Frontend unit
npm test

# E2E
npm run test:e2e
```

### E2E mocking strategy

- **HTTP:** `page.route('**/api/**', …)` with deterministic fixtures in `e2e/fixtures/mocks.ts`
- **Nostr relays (wss):** `page.routeWebSocket(/^wss:\/\//)` stub — replies `["EOSE", subId]` to every `REQ`, `["OK", id, true, ""]` to every `EVENT`. Required because `SimplePool.querySync()` hangs until EOSE; simply closing the socket is not sufficient.
- **NIP-07 login:** `page.addInitScript()` injects `window.nostr` mock (getPublicKey/signEvent/nip04/nip44) and pre-seeds Zustand persist key `mintradar_session` in `sessionStorage`

### Notable finding (not a bug)

The `+ Watch` button on Dashboard mint cards only renders when `isLoggedIn === true` (intentional — watchlist is identity-bound). E2E tests for the add-to-watchlist flow therefore require a mocked NIP-07 session.

### CI

`test` job in `.github/workflows/deploy.yml` runs the full suite (backend + frontend unit; e2e is separate). `deploy` job declares `needs: test` — a failing test blocks deployment.

## Key rules
- **Before starting ANY new task, check `git branch --show-current`.** If it isn't `main`, find out why (an in-progress PR still awaiting merge vs. a forgotten checkout left over from a prior session) before committing anything. A 2026-08-05 session left a feature branch checked out after its PR had already merged; two unrelated follow-up fixes got committed there instead of on `main` and had to be recovered via a second PR (#54).
- NEVER modify anything not explicitly requested
- ALWAYS run typecheck before build — `npm run typecheck` is `tsc -b` (app + node projects, noEmit, buildinfo gitignored). It used to be `tsc --noEmit` on the root tsconfig, which has `files: []` and only references, so it checked 0 files (fixed 2026-10-03)
- ALWAYS rsync dist after build
- ALWAYS commit and push after deploy: `git push origin main && git push gitea main` (both remotes required)
- Conventional commits: feat:, fix:, refactor:, docs:, chore:
- Security: always audit new code for SSRF, rate limits, XSS
- Security: `verifyEvent()` from nostr-tools must be called on all inbound Nostr events (frontend hooks and backend discovery)
