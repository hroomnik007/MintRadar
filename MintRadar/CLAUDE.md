# MintRadar — Claude Code Context

## Project
Privacy-first Cashu mint monitoring PWA.
Live: https://mintradar.pedani.eu
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
- CSS: CSS variables — "patina/copper" palette as of 2026-07-24 (var(--bg) #10201c, var(--surface)/var(--surface-2)/var(--surface-3), var(--green)/var(--green-bright) #45ad8c/#5cc9a3, var(--copper) #c98058, var(--amber), var(--red), var(--text)/var(--text-dim)/var(--text-faint)); see "Visual Redesign" section below for details

## Architecture
- Personal watchlist → IndexedDB (never on server); logout calls resetInMemory() — Dexie NOT wiped on logout; see Watchlist Persistence below
- Public mint history → PostgreSQL (mint_history table)
- Mint discovery → NIP-87 kind:38172 server cron every 6h + client-side after Nostr login
- Backend proxy → /api/* proxied by Nginx to localhost:3002
- Cron every 5min → probes all mints via /v1/info → writes to mint_history
- Online status: mint is ONLINE only if /v1/info returns HTTP 200 with valid JSON containing `nuts` field
- Nostr DM notifications → browser-side via NIP-07 when watchlist mint goes down/up
- Reviews → NIP-87 kind:38000 events, read/write directly from browser via Nostr relays

## DB Tables

### mints
```
url TEXT PRIMARY KEY
name TEXT
discovered_at TIMESTAMPTZ DEFAULT NOW()
is_known BOOLEAN DEFAULT FALSE
icon_url TEXT
version TEXT
nut_count INTEGER
tos_url TEXT
description_long TEXT
nuts_limits JSONB
audit_n_mints INTEGER
audit_n_melts INTEGER
audit_n_errors INTEGER
audit_checked_at TIMESTAMPTZ
last_trust_score INTEGER
last_error TEXT
```

### mint_history
```
id BIGSERIAL PRIMARY KEY
url TEXT REFERENCES mints(url) ON DELETE CASCADE
online BOOLEAN NOT NULL
latency_ms INTEGER
checked_at TIMESTAMPTZ DEFAULT NOW()
```
Index: (url, checked_at DESC)

### mint_version_history
```
id BIGSERIAL PRIMARY KEY
url TEXT REFERENCES mints(url) ON DELETE CASCADE
version TEXT NOT NULL
first_seen_at TIMESTAMPTZ DEFAULT NOW()
UNIQUE (url, version)
```

## Backend API
- GET /health — health check
- GET /api/mints/known — all mints with online status, latency, trust score, degraded flag (TTL cached 60s)
- GET /api/mints/history?url=&period={24h|7d|30d|90d} — bucketed uptime/latency segments + prev period trend
- GET /api/mints/version-history?url= — per-mint software version timeline + latest global version
- GET /api/mints/daily-uptime?url= — daily uptime counts for last 30 days
- GET /api/stats — network-wide stats: totalMints, onlineMints, offlineMints, avgTrustScore, avgLatency24h, trustDistribution, nutAdoption, top5ByTrustScore
- GET /api/mint/probe?url= — on-demand probe of a single mint URL
- POST /api/mint/submit — submit new mint URL { url: string }, rate limited 20/IP/hr
- POST /api/mints/discover — batch insert discovered URLs { urls: string[] }, rate limited 10/IP/hr

## /api/stats calculation rules
- totalMints: mints where latest online IS NOT FALSE (online=true or null) — matches Dashboard "Known Mints"
- onlineMints: mints where latest online = true
- offlineMints: totalMints - onlineMints
- avgTrustScore: average of (last_trust_score ?? 0) for online mints only — matches Dashboard calculation
- trustDistribution: low/moderate/high counts from online mints only (same filter as avgTrustScore)

## Trust Score calculation (server-side, in prober.ts)
- Uptime 45%: uptimePct * 0.45 (from 24h mint_history)
- NUT Support 30%: min(nutCount/26, 1) * 30
- Version freshness 15%: based on Nutshell version recency
- Audit reliability 5%: based on error rate from a **rolling window of the mint's last ~100 swaps** (`audit_recent_errors`/`audit_recent_total`, fetched per-mint from `GET /swaps/mint/{id}` on audit.8333.space — see Discovery pipeline below), not audit.8333.space's cumulative lifetime counters — bucket logic (0%→5, <1%→4, <5%→3, <15%→2, ≥15%→1, null or <3 samples ("Unknown")→2.5) lives in `backend/src/shared/auditScore.ts` (`auditReliabilityScore()`/`isAuditUnknown()`), the source of truth shared with the frontend's Trust Score Breakdown. `src/utils/auditScore.ts` is a manually-synced copy (the two packages have no workspace set up between them) — edit both if the logic ever changes. `audit_n_mints`/`audit_n_melts`/`audit_n_errors` (cumulative lifetime counts) are kept separately and still used for the read-only "Audit stats" panel on Mint Detail — they no longer feed the score.
- Stored in mints.last_trust_score after each probe

## Cron jobs
- Every 5min: probe all mints in DB → write to mint_history, update mints metadata + last_trust_score
- Every 6h: NIP-87 discovery from 7 relays + audit.8333.space API → INSERT new mints

## Discovery pipeline

`discoverMintsFromNostr()` in `backend/src/discovery.ts` runs 3 sources in parallel via `Promise.allSettled`:
- **kind:38172** — NIP-87 mint announcements (direct `u` tag)
- **kind:38000** — reviews; `#u` tag mining extracts reviewed mint URLs
- **audit.8333.space** — external audit API. `discoverMintsFromApi()` does 2 passes over the ~65 mints audit.8333.space knows about: (1) one paginated `GET /mints/` call (100/page) for discovery + cumulative lifetime counts (`audit_n_mints`/`audit_n_melts`/`audit_n_errors`, display-only, feeds the "Audit stats" panel) and to capture each mint's audit.8333.space `id` (stored as `audit_id`); (2) a sequential per-mint `GET /swaps/mint/{id}?limit=100` pass (~65 extra requests, 150ms apart) for the rolling-window reliability score (`audit_recent_total`/`audit_recent_errors`, feeds Trust Score — see above). Runs once per 6h discovery cycle, so ~65 extra requests/6h — not throttled further, well within reasonable API use.

Approximate yields (as of 2026-06-29): kind:38172 ~33 mints, kind:38000 ~37 mints, audit.8333.space ~61 mints. Total DB: ~97 mints.

**URL normalization:** `normalizeUrl()` lowercases the hostname before every INSERT. Applied in 4 places: `discoverMintsFromNostr`, `discoverMintsFromApi`, `POST /api/mint/submit`, `POST /api/mints/discover`. Prevents duplicates like `https://Mint.coinos.io` vs `https://mint.coinos.io` (the capital-M variant was a seed bug and was manually deleted).

## Discovery relays (backend + frontend) — unified 2026-07-24
Frontend source of truth: `src/core/nostr/relays.ts` (`DISCOVERY_RELAYS`), imported by
`src/core/nostr/mintDiscovery.ts` and `src/hooks/useNostrDiscovery.ts`. Backend can't import
this (separate npm package, no workspace set up) — `backend/src/discovery.ts` keeps its own
`DISCOVERY_RELAYS` constant manually in sync; mirror any change to both.

wss://relay.damus.io, wss://nos.lol, wss://purplepag.es, wss://relay.snort.social,
wss://relay.primal.net, wss://relay.cashumints.space, wss://relay.azzamo.net,
wss://eden.nostr.land, wss://nostr.wine, wss://nostr-pub.wellorder.net,
wss://offchain.pub, wss://relay.8333.space, wss://nostr.oxtr.dev, wss://relay.nostr.net,
wss://nostr21.com, wss://nostr.bitcoiner.social, wss://nostr.cypherpunk.today

**2026-08-16 — `nostr.bitcoiner.social` and `nostr.cypherpunk.today` added**, alongside
`relay.snort.social` filling in wherever it was still missing. Verified reachable (TCP:443
connect) before adding. Requested to go into every relay list in the project, not just the
unified discovery set above — also added to `REVIEW_PUBLISH_RELAYS`/`PROFILE_RELAYS`
(`src/core/nostr/relays.ts`), `META_RELAYS`/`NOTIFICATION_RELAYS` (backend `nostrService.ts`
+ frontend `client.ts`/`useWatchlistNotifications.ts`), `NIP46_RELAYS` (`client.ts`),
`BOOTSTRAP_RELAYS` (`useUserRelays.ts`), `FOLLOW_RELAYS` (`useFollowRecommendations.ts`), and
`WATCHLIST_RELAYS` (`watchlistSync.ts`) — i.e. every relay array in the codebase, not just
the 4 "unified" discovery/review locations this section otherwise tracks. `REVIEW_PUBLISH_RELAYS`'s
own explicit `nostr.bitcoiner.social` entry was removed since it's now inherited via
`DISCOVERY_RELAYS` (same dedup pattern as the `nostr.oxtr.dev` case below).

`wss://relay.8333.space` was added to every discovery/review relay list in the project —
same operator as `audit.8333.space`, likely higher density of Cashu-specific NIP-87 events.

**2026-08-15 — `relay.nostr.band` replaced, 3 relays added (all 4 relay-list locations):**
User noticed devtools showing `relay.nostr.band` (`NS_ERROR_UNKNOWN_HOST`/timeout) and
`relay.8333.space` (`NS_ERROR_CONNECTION_REFUSED`) failing, plus `relay.damus.io`
returning occasional 503s. Investigated each:
- `relay.nostr.band` — genuinely down (TCP handshake to `95.216.33.150:443` hangs/times
  out; confirmed not a general network issue since other Hetzner-hosted relays, e.g.
  `nos.lol`, connect fine). **Replaced** with `eden.nostr.land` everywhere it appeared.
- `relay.8333.space` — also down right now (`EHOSTUNREACH`), but **kept** in the list (its
  Cashu-specific NIP-87 density is worth it once it recovers — same operator as
  `audit.8333.space`, which is up).
- `relay.damus.io` 503s — NOT a bug, confirmed by hammering it with 10 sequential
  WebSocket connects: ~20% hit HTTP 503 (Cloudflare load-shedding), ~80% open in
  ~200-400ms. `sharedPool` already races all relays in a list simultaneously
  (`querySync`/`subscribeMany`), so this doesn't cause user-visible failures — it was
  flagged in devtools but the login flow succeeded regardless. No fix needed.
- **Added** `nostr.oxtr.dev` (99ms connect — already trusted, was previously only in
  `REVIEW_PUBLISH_RELAYS`'s own extra list; that duplicate entry was removed since it's
  now inherited via `DISCOVERY_RELAYS`), `relay.nostr.net` (284ms), and `nostr21.com`
  (483ms) — all verified reachable via a direct `ws` handshake test before adding.
  `relay.current.fyi` (DNS doesn't resolve) and `relay.nostrati.com`/`relayable.org`
  (502/timeout) were also tried as candidates and rejected as unreliable.
- All 4 relay-list locations kept in sync: frontend `DISCOVERY_RELAYS` + `PROFILE_RELAYS`
  (`src/core/nostr/relays.ts`), backend `DISCOVERY_RELAYS` (`discovery.ts`), backend
  `NOSTR_REVIEWS_RELAYS` (`index.ts`).

**Streaming vs. batch discovery:** considered and deliberately rejected. Discovery runs in
the background with no live UI to update, so a streaming subscription (incremental
per-event handling) wouldn't produce any visible benefit over the current EOSE/timeout
batch pattern (`querySync` + race against a timeout, or `subscribeMany` resolved on
`oneose`). Do not "improve" this to streaming without a concrete reason.

## Key features
- Dashboard: compact/expanded card view, advanced filter panel (Status/TrustScore/Age/NUTs), search, sort, mint comparison tool (up to 4), stats bar, submit form (single + bulk)
- Mint Detail: MOTD, NUT compatibility grid with modal, NUT limits (NUT-04/05), historical charts (24h/7d/30d/90d, Latency/Uptime/Trust), Mint History panel, version history, Trust Score gauge with breakdown, Audit stats, Add to Wallet + QR, NIP-87 reviews, mint age badges, backup checker (NUT-13)
- Stats page: totalMints/onlineMints/offlineMints/avgTrustScore/avgLatency cards, NUT adoption horizontal bars (color-coded), Trust Score donut chart, Top 5 by Trust Score
- Watchlist: IndexedDB only, Nostr login required, export JSON/CSV, DM notifications (NIP-07)
- Nostr: NIP-07 login, profile fetch (kind:0), reviews (kind:38000), DM notifications (kind:4), watchlist sync (NIP-44 kind:10003)

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

## Deploy Pipeline Notes

- The ONLY active GitHub Actions workflow is `/.github/workflows/deploy.yml` at the **repo root**. A dead duplicate previously existed at `MintRadar/.github/workflows/deploy.yml` inside the project subdirectory — GitHub Actions never ran it, but it caused confusion during debugging. It has been deleted. When editing CI/CD config, always confirm you're editing the root-level file.
- The deploy sequence runs `sudo rm -rf /var/www/mintradar/dist/assets/*` before copying the new build. This is intentional: `rsync --delete` was silently failing to remove old `root:root`-owned asset files left over from a prior deploy mechanism while still reporting success, causing stale content-hashed files to accumulate alongside new ones.
- The GH Actions workflow SSHes into the VPS, pulls latest code, builds on the server (`npm ci && npm run build`), then copies dist to the nginx root. The `rsync dist/` step documented in the deploy workflow above reflects the original mechanism — the active workflow in `.github/workflows/deploy.yml` is authoritative.
- **GOTCHA — Dependabot PRs:** Never merge multiple Dependabot PRs in rapid succession. Each merge triggers a GH Actions deploy that runs `rm -rf node_modules && npm ci` on the VPS. Concurrent runs race on the same node_modules directory, corrupting TypeScript's lib files and causing `Cannot find global type 'Boolean'` / `lib.es2022.d.ts not found` errors. Merge one, wait for the run to complete, then merge the next.
  - **Two layers of automated protection now in place (2026-08-15, following the lucide-react/stray-node_modules incident below):** (1) `.github/workflows/deploy.yml` has a workflow-level `concurrency: group: deploy-${{ github.ref }}, cancel-in-progress: false` guard — overlapping pushes to `main` now queue and run sequentially instead of racing on the VPS path (`cancel-in-progress: false` deliberately, since the deploy does `git reset --hard origin/main`+`npm ci` and a cancelled mid-deploy could leave the VPS in a worse state than a queued one). (2) `.github/dependabot.yml` now groups all npm updates per directory into a single PR (`groups: all-dependencies: patterns: ["*"]`) instead of one PR per bump, so a Dependabot run produces one merge/one deploy instead of ~10. The manual "merge one, wait for the run to complete" discipline below is now a backstop, not the only defense — but still follow it for any PRs that arrive outside Dependabot's own grouping (e.g. manually opened PRs, or if grouping is ever reverted).
  - Confirmed working (2026-07-24, commit 9abda76 session): 10/10 open Dependabot PRs (patch/minor bumps + one ESLint 9→10 major) merged sequentially, each followed by `gh run watch` on the deploy workflow before starting the next. Zero failures, zero VPS races.
  - **ESLint major-version bumps:** before writing/changing any `eslint.config.js`, check whether the package actually has its own config file. `MintRadar/backend` has none — its `npm run lint` resolves ESLint's flat config by walking up to `MintRadar/eslint.config.js` (this works because ESM imports inside that config file resolve relative to the config file's own path, not the invoking CWD). Verify this kind of resolution still works after a major bump with `eslint src/ --debug 2>&1 | grep -i "config"` (look for `Using config file ... and base path ...` plus a nonzero linted-file count) *before* assuming a config rewrite is needed.
  - **`npm install`/`npm ci` working directory:** this is a monorepo with THREE `package.json` locations if you're not careful — `MintRadar/` (frontend), `MintRadar/backend/`, and (accidentally, if you run `npm install` from the repo root) a stray root-level one. Always run `pwd` immediately before `npm install`/`npm ci` here. A 2026-07-24 session created a stray root `package.json`/`package-lock.json`/`node_modules` this way mid-Dependabot-batch (caught via `git status` before committing, deleted, redone in the right directory) — the same class of mistake previously happened in the separate Finvu project too.
    - **This stray root `node_modules` can outlive the session that created it and cause real prod failures much later.** On 2026-08-15, a stray `/var/www/mintradar-repo/node_modules` (no `package.json` alongside it — pure orphaned directory, dated back to that 2026-07-24 incident and never cleaned up on the VPS itself, only fixed locally/in git) sat there for three weeks. Two deploys fired ~11s apart (two rapid-succession `main` pushes), racing on `MintRadar/node_modules` during `npm ci`; while `MintRadar/node_modules` was transiently incomplete, Node's module resolution walked up the directory tree and resolved `vite`/`rollup` from that ancient orphaned root `node_modules` (`vite@5.4.21`, no `lucide-react` at all) instead of the correct `MintRadar/node_modules` (`vite@8.1.0`), producing a red herring error — `[vite-plugin-pwa:build] Failed to resolve entry for package "lucide-react". The package may have incorrect main/module/exports specified in its package.json` — that looked exactly like a bad Dependabot version bump but had nothing to do with lucide-react's actual version (unchanged since 2026-07-24) or any PR merged that day. **Diagnostic tell:** the build log's stack trace paths (`file:///var/www/mintradar-repo/node_modules/...` vs `.../MintRadar/node_modules/...`) reveal which `node_modules` actually got used — check this before suspecting a dependency itself. **Fix:** `rm -rf /var/www/mintradar-repo/node_modules` (verify no `package.json` sits next to it first — if one exists, investigate before deleting) in addition to the normal `rm -rf MintRadar/node_modules && npm ci` clean-reinstall. Consider checking for this stray directory as a periodic VPS health check, not just after an incident.
  - **Batch 3 (2026-08-15, first grouped PRs #67/#68 after the grouping fix above):** Dependabot's grouping produced exactly 2 PRs (backend 9 updates, frontend 23 updates) instead of ~30 individual ones — grouping confirmed working. Both PRs bundled `typescript` 6.0.3/5.9.3 → **7.0.2**, the same version that broke `npm ci` earlier that day (still incompatible — `@typescript-eslint/eslint-plugin`'s peer range is `<6.1.0` even at its own latest 8.67.0). Fixed by checking out each PR branch locally, reverting just the `typescript` line in `package.json`, regenerating the lockfile (`npm install typescript@<pinned> --save-dev`), verifying `npm ci`+`tsc --noEmit`+tests+build, then pushing that commit onto the PR branch before merging — grouping means you can't cherry-pick individual bumps out of the GitHub UI, so this local-branch-surgery pattern is the way to exclude one bad bump from an otherwise-good group.
    - The frontend PR (#68) also bundled `immer` 10.2.0→11.1.16 (previously held back, see `immer` entry below) and `@noble/hashes` 1.8.0→2.3.0 — both excluded the same way pending separate verification (done shortly after, see below), plus a genuine mistake caught mid-fix: `npm install <pkg> --save-dev` moved `immer` from `dependencies` into `devDependencies` even though only `typescript` needed `--save-dev` — always install multiple packages with different target sections in separate commands, or fix the section placement manually afterward and verify against `main`'s existing placement.
    - **Follow-up same-day: `immer` 11.1.16 and `@noble/hashes` 2.3.0 verified and applied** (commit `06357dd`). `@noble/hashes` v2's only breaking change is its `exports` map requiring explicit `.js` subpath extensions — fixed the one import site (`src/core/nostr/client.ts`: `'@noble/hashes/utils'` → `'@noble/hashes/utils.js'`), verified `bytesToHex`/`hexToBytes` round-trip at runtime. `immer` v11 needed no source changes; since `watchlist.store.ts` (the one real usage of the `zustand/middleware/immer` integration) has no dedicated unit tests and `vitest.config.ts` has no path-alias resolution (unlike `vite.config.ts` — the two configs are NOT merged, so any `@/...`-importing module can't be tested without a temporary local alias addition to `vitest.config.ts`), a throwaway smoke-test file was written against the store directly (mocking `@/db`) to confirm draft mutations (`push`/`filter`) and state-reference immutability still work, then deleted after confirming — this pattern (temporary vitest.config.ts alias + throwaway test file, both discarded) is worth reusing for verifying any other `@/`-importing module in isolation. Bonus: `vendor-immer` bundle shrank 26.6kB→9.16kB gzip on the v11 upgrade.
  - **Batch 2 (2026-08-01, PRs #32-#41):** 10/10 merged sequentially, same one-at-a-time + `gh run watch` discipline as batch 1. Zero failures.
    - Patch/minor: `@types/supertest`, `@vitest/coverage-v8`, `@tanstack/react-query`, `ws` (frontend only — backend still declares `ws@^8.21.0`; Dependabot hasn't opened a matching backend PR yet), `eslint` (backend, 10.6.0→10.8.0), `tsx`, `@playwright/test`, `nostr-tools` (backend, 2.23.5→2.24.1).
    - Major bumps (extra scrutiny, both verified safe with no source changes needed):
      - `react-router-dom` 6→7 — the app has no loaders/actions/fetchers/`json()`/`defer()`, so v7's main breaking surface (the data APIs) doesn't apply. Side effect: `react-router` no longer lands in the `vendor-react` chunk (+~9 kB gzip in the initial payload) — documented, not addressed; revisit only as part of a dedicated chunking pass.
      - `@noble/secp256k1` 2→3 — the app calls it in exactly one place (`getPublicKey` for nsec login) and never signs with it, so v3's breaking surface (the signing API) doesn't apply. Verified byte-identical output against an independent oracle, confirmed the `privkeyBytes.fill(0)` zeroing guarantee still holds, and manually exercised all three login flows (nsec/NIP-07/NIP-46) in a real browser.
    - `nostr-tools` and `@noble/secp256k1` are completely independent — `nostr-tools` depends on `@noble/curves`, not the standalone `@noble/secp256k1` package, which is physically absent from the backend's dependency tree.
    - PRs #22-31 from batch 1 closed themselves in the meantime (Dependabot detected the bumps were already applied directly to `main` and auto-closed the stale PRs) — no manual cleanup needed; expect the same on future batches.
  - **VPS maintenance (2026-08-07):** `docker builder prune -f` freed 10.81 GB of build cache, taking free disk from 17GB to 28GB — worth running periodically if disk pressure shows up again. A one-off deploy race ("removal of container is already in progress") was caused by two deploys firing back-to-back and colliding on `node_modules` during the backend `tsc` build — not a recurring problem, no fix needed unless it repeats. If it does repeat, consider adding `docker compose down --timeout 10` before `up` in the deploy script (not yet implemented).

## Nostr Login

Login modal (`src/components/layout/AppShell.tsx`) supports three methods selectable via radio cards:
- **NIP-07** — calls `window.nostr.getPublicKey()`; all signing stays in the extension
- **nsec** — decoded in `src/core/nostr/client.ts:loginWithNsec`, then held in a module-scoped variable (`activeNsecPrivkey`) for the session via `installNsecShim()` so the app can sign on the user's behalf (notifications, watchlist sync, reviews) — mirrors `installBunkerShim()`'s pattern. **Never written to any storage API** (sessionStorage/localStorage/IndexedDB) — in-memory only, so it does not survive a page reload. Zeroed via `.fill(0)` and cleared on logout by `removeNsecShim()` (called from `useAuthStore.logout()`, alongside `removeBunkerShim()`). The login modal explicitly discloses this to the user (nsec security notice box + footer line in `AppShell.tsx`).
- **Amber / NIP-46 bunker** — fully implemented via `nostr-tools/nip46` `BunkerSigner`; accepts `bunker://` URI or NIP-05 identifier; QR pairing flow for mobile Amber; session persisted in `sessionStorage` (`bunkerURI`, `bunkerClientSecretKey`, `bunkerPubkey`); 30s connection timeout; client keypair is ephemeral (NOT the user's identity key)

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

## Security & Infrastructure Gotchas

### nginx CSP: `wss:` must be explicit in connect-src

**GOTCHA — do not regress this.** `connect-src 'self' https:` does NOT cover `wss://` connections in practice. This was a real production incident: Nostr relay WebSocket connections (`wss://relay.damus.io/`, `wss://nos.lol/`, etc.) were blocked by the browser until `wss:` was added explicitly.

Current correct value: `connect-src 'self' https: wss:;`

### nginx add_header non-inheritance

**GOTCHA.** When a `location {}` block defines ANY `add_header` directive, it does NOT inherit the parent `server {}` block's `add_header` directives. Security headers (CSP, HSTS, X-Frame-Options, etc.) MUST be repeated verbatim in every `location` block that defines its own `add_header`.

Affected blocks in `deploy/nginx.conf`: `location ~* \.(js|css|png|svg|ico|woff2|webmanifest)$` and `location = /sw.js`.

### deploy/nginx.conf is reference/documentation only

The file `deploy/nginx.conf` in the repo documents the intended production config but is NOT automatically deployed. The live config lives at `/etc/nginx/sites-available/mintradar.pedani.eu.conf` on the VPS and must be manually kept in sync. After updating `deploy/nginx.conf`, copy the relevant changes to the VPS manually and run `sudo systemctl reload nginx`.

### Service Worker / PWA auto-update

`vite-plugin-pwa` (`registerType: 'autoUpdate'`) only reliably delivers deploys to users when ALL THREE of the following are correct simultaneously:

1. **`public/registerSW.js` listens for `controllerchange` and calls `window.location.reload()` exactly once** — guarded by `let refreshing = false` to prevent reload loops. This file intentionally overrides the library-generated registration script.
2. **`register()` uses `updateViaCache: 'none'`** — without it, the browser may HTTP-cache the workbox chunk (`workbox-xxxxx.js`) that `sw.js` imports, causing update detection to silently fail even though `sw.js` itself is fetched fresh via nginx `no-store`.
3. **nginx serves `sw.js`, `registerSW.js`, and `manifest.webmanifest` with `no-store`** — these files must NOT be caught by the long-lived `immutable` caching rule for content-hashed assets. The explicit `location = /sw.js` and `location = /registerSW.js` blocks in `deploy/nginx.conf` take priority over the wildcard `location ~*` block; do not remove them.

`setInterval(() => registration.update(), 3600000)` in `public/registerSW.js` ensures long-open tabs detect new deploys without requiring a navigation event.

**One-time bootstrap issue:** A user with a very old SW (from before the `controllerchange` listener existed) must manually unregister once via DevTools → Application → Service Workers → Unregister. All subsequent deploys auto-update from that point forward.

### Debugging stale-looking deploys

When a deployed change doesn't appear to users, verify in this order before assuming a code bug:

1. Commit is pushed to `origin/main` and the GH Actions run completed successfully
2. `curl` the exact asset filename referenced by the live `index.html` — confirm the response body contains the expected change (don't trust local build state or git log alone)
3. Only then suspect the service worker / browser cache as the culprit

**Color can mask font-weight:** If a computed property looks "correct" in DevTools but still LOOKS wrong visually, inspect all related computed properties. Example: `font-weight:700` on `var(--text2)` (`#8B90A0`, muted gray) looks visually weaker than non-bold `var(--text)` (`#F0F2F7`, near-white) — this led to a false diagnosis of "bold not working" when the real issue was a color override. Always check the full computed style.

**Synthetic (faux) bold:** JetBrains Mono (`var(--font-mono)`) was only self-hosted at weights 400 and 500. Using `font-weight:700` on any mono element triggered browser-synthesized bold, which renders very weakly. `public/fonts/JetBrainsMono-Bold.woff2` was added with a matching `@font-face` at weight 700 to fix this.

### vault.ts removed (dead code)

`src/core/crypto/vault.ts` was deleted. It had zero imports across the codebase and contained a broken nsec bech32 decode (`.slice(5)` instead of `nip19.decode`). The entire `src/core/crypto/` directory no longer exists — do not recreate it.

### MintCard.tsx — history (was dead code, now the real shared component)

An earlier `src/components/mint/MintCard.tsx`/`.css` was deleted (zero imports at the time). For a while Dashboard and Watchlist each had their own separate inline card renderer instead of a shared one.

**This is no longer true as of the "Post-redesign fixes round 2" session (commit f98694a) below.** `src/components/mint/MintCard.tsx` was recreated and is now the real, actively-imported shared card component used by both `src/pages/Dashboard.tsx` and `src/pages/Watchlist.tsx`. Any task targeting "the mint card" or "the watch button" should edit this file — not Dashboard.tsx/Watchlist.tsx directly — unless the change is genuinely page-specific.

### Security audit

Full report in `AUDIT.md` at the repo root. Covers: telemetry, key handling, dependencies, XSS, backend API, secrets, Docker, HTTP headers. Backend is at 0 npm vulnerabilities. Frontend has 6 remaining (all dev-server only; Vite v8 upgrade needed to fix).

## Dependency versions (as of 2026-06-29)

### Frontend
- eslint: 10.6.0 (upgraded from 9.x)
- eslint-plugin-react-hooks: 7.1.1 (upgraded from 5.2.0 — v7 adds ESLint v10 support)
- lucide-react: 1.22.0
- globals: 17.7.0
- @types/node: 26.0.1
- immer: 11.1.16 (upgraded 2026-08-15 — was held at v10 pending verification with Zustand, now confirmed compatible, see the "GOTCHA — Dependabot PRs" Batch 3 note above)
- @noble/hashes: 2.3.0 (upgraded 2026-08-15 — v2's `exports` map requires explicit `.js` subpath extensions; see Batch 3 note above)

### Backend
- undici: 8.5.0 (security fix — 8 CVE patched)
- pg: 8.22.0
- node-cron: 4.5.0
- @typescript-eslint/eslint-plugin: 8.62.0
- @types/node: 26.0.1

## Stats Page Layout (as of 2026-06-29)

3-column grid (`.stats-cards-grid`) with `align-items: start` — cards shrink to content height:
- **Row 1, col 1:** Software in Use (accordion — click SW row to expand versions)
- **Row 1, col 2:** Geographic Distribution
- **Col 3, rows 1–2:** `.stats-right-col` with `grid-row: span 2` (desktop only; resets at ≤1100px) — contains Most Reliable (Top 5) + Trust Score Trend stacked
- **Row 2, col 1–2:** NUT Coverage with `gridColumn: 'span 2'` and `column-gap: 48px` between the two NUT columns

At ≤1100px: `stats-right-col` gets `grid-row: auto`. At ≤700px: single column.

### Network Health Index — final layout (commit 92c28d8, several iterations)

Went through multiple repositioning attempts before landing on the final placement:
- **Final:** own panel in the right column (`.stats-right-col`), stacked between "Most Reliable" and "Trust Score Trend" — not merged with either.
- **Rejected earlier attempt:** living inside the left 3-column block alongside Software in Use + Geographic Distribution. Reverted — the left block is back to its original 2 columns (Software in Use + Geographic Distribution only).
- **NUT Coverage Across the Network** was never touched during any of these iterations — its CSS/position is exactly as in the original "Stats Page Layout" section above.
- Card format: horizontal — 60px ring on the left, badge on the right. `align-items: start` on the outer grid so panels don't stretch/merge into each other.

**Lesson learned:** when a layout "looks different" or "looks empty" mid-iteration, ask immediately for a `getComputedStyle`/pixel probe instead of judging from a screenshot — visual estimation on this task burned several unnecessary rounds before the probe was requested.

## Dashboard Mint Count Distinction (deliberate product decision — 2026-06-20)

The Dashboard stat bar intentionally shows TWO different denominators that represent TWO different concepts:

- **"ONLINE MINTS X/Y" denominator** — "active" mints only (excludes mints that have been offline for 24h+, which are hidden from the grid by default behind a "N mints hidden (offline 24h+) — Show" toggle). Matches what's visible in the grid.
- **"KNOWN MINTS"** — absolute total mint count across the whole system (same source as Stats page "MINTS TRACKED", same as `rows.length` from `/api/stats`). Includes long-offline mints.

These are intentionally different numbers (e.g. "ONLINE MINTS 50/69" vs "KNOWN MINTS 88"). Do NOT "fix" this as an inconsistency in future sessions without re-confirming with the maintainer first.

The grid's default behavior of hiding 24h+ offline mints is intentional decluttering. The footer shows: "Showing X of Y — N mints hidden (offline 24h+) Show".

## Typography & Design System Notes

Self-hosted font weights (unchanged by the 2026-07-24 color redesign — see "Visual Redesign" section below):
- **DM Sans** — variable, weights 100–900; `--font-body`, `--font-display`, `--sans`
- **JetBrains Mono** — 400 Regular, 500 Medium, 700 Bold; `--font-mono` (non-numeric mono text: pubkeys, URLs, version strings). Bold was added in `public/fonts/JetBrainsMono-Bold.woff2` + `@font-face` because weight 700 previously triggered faux bold.
- **`--font-mono-data`** (new, 2026-07-24) — system `ui-monospace` stack (no webfont), used exclusively for numeric/data values (latency, %, NUT counts). See "Visual Redesign" section.

**Stat box padding** — Desktop: Dashboard `.stat-card` and Stats `.stats-metric-card` both use `14px 20px`. MintDetail `.md-sc` uses `12px 16px` intentionally (tighter layout, product decision — do not "unify" without confirmation). Mobile: Dashboard reduces to `10px 14px` at `≤600px`; Stats reduces to `10px 14px` at `≤700px`.

**Mint Info value rows** (MintDetail) — all value `<span>` elements use `.md-info-value` class only, with no inline color/weight/family overrides. Inline `color: var(--text2)` previously made bold text look dim. Full description keeps `style={{textAlign:'left', maxWidth:'none', lineHeight:1.5}}` for layout only.

**Text colors (as of 2026-07-24 redesign)** — `--text` (`#f2f7f4`) for primary/bold values, `--text2`/`--text-dim` (`#b7c8c0`) for secondary/muted, `--text3`/`--t3`/`--text-faint` (`#86988f`) for tertiary labels. These replace the old DM Sans v2 values (`#F0F2F7`/`#8B90A0`/`#AAB4C7`) — verified at ~5.5:1 contrast (WCAG AA) on the new `--bg` for the weakest pair (`--text-faint` on `--bg`).

## Visual Redesign — "Patina/Copper" Palette (2026-07-24)

**Why:** the original palette (pure `#000` background + full neon green) had low contrast on
secondary text and a "punk"/cheap look on buttons (solid color fill, large pill radius with
no subtlety). The new palette fixes both.

**Reference mockup:** `mintradar_redesign_mockup.html` (repo root) — an interactive
Dashboard/Mint Detail/Login/Watchlist/Stats preview, desktop + mobile. Treat it as the
source of truth for any future palette/component work; check it before changing colors again.

**New design tokens (`src/index.css`):**
- `--bg` / `--surface` / `--surface-2` / `--surface-3` — dark "verdigris/patina" green-gray instead of pure black (`--bg: #10201c`)
- `--text` / `--text-dim` / `--text-faint` — see Typography section above for exact values and contrast verification
- `--green` / `--green-bright` — muted "patina" green instead of neon (reference: patina on coins)
- `--copper` — new secondary accent (reference: coin minting); alternates with green on the Stats page's Software-in-Use and Geographic-Distribution bars
- `--amber`, `--red` — semantic colors (fresh/warning, offline/error)
- every color has a `-soft` and `-soft-strong` variant, used for tonal backgrounds/borders instead of solid fills
- `--font-mono-data` — system `ui-monospace` stack for numeric values only (see Typography section)
- `--radius-m` (10px) — smaller radius for buttons, replacing the old large pill shape
- fonts remain 100% system/self-hosted — no Google Fonts, no external CDN, zero tracking

**Component changes:**
- Buttons (`Login via Nostr`, `Connect`, `+Submit mint`, `+Watch`, `Compare`) — solid neon fill → tonal outline style
- Dashboard mint cards — removed the per-status colored border/gradient (previously every card had a green-tinted border/background regardless of online/offline state); now a neutral border, with color reserved for the status dot and the trust-score chip only
- Login modal — option cards (Nostr extension/nsec/Amber) get a green tonal border+background only when selected; the nsec security notice box changed from yellow to copper
- Trust Score ring (Mint Detail) — fixed `--green-bright` ring color (no longer colored by score band), track `--surface-3` — the ring is now purely visual, the score band ("High/Moderate/Low Trust") is still conveyed by the badge text below it
- `mintAgeBadge()` (`src/utils/mintFormatting.ts`) — Established badge → new tonal green, Fresh badge → copper/amber (was blue); Veteran/OG badges intentionally unchanged (out of scope)
- Stats page — progress bars alternate green/copper by row index instead of one fixed color for all

**Audit reliability score:** see the shared-module note under "Trust Score calculation" above.

**Audit data source (resolved 2026-08-06):** `audit.8333.space`'s `GET /mints/` API (paginated,
100/page) returns cumulative lifetime counts for `n_mints`/`n_melts`/`n_errors` — these are kept
(as `audit_n_*`) purely for the display-only "Audit stats" panel. The Trust Score's audit
component now matches the reference `pablof7z/cashu-mint-audit` project's approach: it uses a
rolling window of each mint's last ~100 swaps, fetched per-mint from `GET /swaps/mint/{id}`
(`audit_recent_total`/`audit_recent_errors`) — see "Discovery pipeline" above. A mint with fewer
than 3 recent swaps scores as "Unknown" (2.5, same neutral default as no audit data at all)
instead of a misleadingly precise error rate from a tiny sample.

**Manually added mint:** `mint.hanbitkorea.org` was found via an `audit.8333.space` cross-check
and was missing from the DB; added manually.

### Post-redesign fixes (commit 3af7e6f)

Follow-up fix commit addressing regressions/missed spots from the original redesign above:
- Nav bar (`AppShell.css`) — background changed from hardcoded `rgba(15,17,21,.92)` to `var(--bg)`, removing a visible "seam" against the page body
- Stats — Software in Use expand panel (`Stats.css`, `.sw-ver-panel`) — hardcoded `#0d1117` → `var(--surface-2)`
- Stats — Geographic Distribution modal (`Stats.tsx`, `CityMintsModal`) — rebuilt to match the Trust Score/NUT modal pattern (flag+name+count chip+close header, status dot/name/badge/trust % rows, footer summary); status dot and trust colors moved to the new tokens, percentage uses `--font-mono-data`; functionality (click-through to detail, sorting) unchanged
- Mint Detail — "Show QR code" and "Copy" buttons (`MintDetail.tsx`) — solid neon fill → tonal outline, matching "Compare"/"+ Watch"
- Watchlist — Login button (`Watchlist.tsx`) — added ⚡ icon, now identical to the nav button

Reference mockup `mintradar_redesign_mockup.html` (tab "Opravy") shows before/after for all 5 items; the mockup is now included directly in this commit.

Verified: typecheck, ESLint, 70/70 unit tests, production build all pass; visually confirmed via Playwright.

### Post-redesign fixes round 2 (commit f98694a)

- New shared component `src/components/mint/MintCard.tsx` — used by both Dashboard and Watchlist (Watchlist previously had its own, non-redesigned copy of the mint card). If the card style changes again, change only this file.
- Shared utilities moved into `mintFormatting.ts`: `mintAgeBadge`, `uptimeColor`, `formatTimeAgo` — Watchlist no longer has its own duplicate version.
- New design token `--surface-card` (slightly lighter than `--surface`) + `inset` top highlight on `.mint-card` — visually distinguishes mint cards from other panels.
- Watchlist CTA (empty state) — `.wl-add-btn` is a solid primary button (`var(--green)` fill), deliberately distinct from the smaller outline nav button (secondary vs. primary action).
- Offline/degraded mint cards — opacity 0.7, "Offline 24h+" badge, "Last seen" (from `lastCheckedAt`) instead of latency.
- Mint Detail mobile header — compact version on the mobile breakpoint only (icon back button, online pill on the same row, Watch/Compare 50/50); desktop layout unchanged.
- "Show my latency" button unified with the others (tonal outline).
- "NIP-87" badge on Watchlist: purple → copper (`--copper`).

Reference mockup `mintradar_redesign_mockup.html` (tabs "Watchlist prihlásený", "Mint Detail mobil header", "Latency btn / Offline / Card elevation") documents before/after for all items.

Verified: typecheck, ESLint, 70/70 unit tests, production build all pass; visually confirmed via Playwright with mocked API (7 screenshots).

### Card elevation contrast fix (commit 9abda76)

The `--surface-card` token introduced in round 2 above was visually too subtle — on an actual screenshot it was nearly indistinguishable from `--bg`. Strengthened:
- `--surface-card`: `#1c2b25` → `#223a2f`
- `.mint-card` border: now `var(--border-strong)` directly (not just on `:hover`)
- Inset top highlight: opacity `.05` → `.07`

Applied automatically everywhere via the shared `MintCard.tsx` component (Dashboard and Watchlist both pick it up with no per-page changes needed) — see "MintCard.tsx — history" above for why that component being shared matters here.

### QR modal design fix + Mint Detail mobile header v2 (retry)

- QR "Add to wallet" modal — container hardcoded `#161b22`/`#30363d` → `var(--surface-2)`/`var(--border-strong)`; header icon replaced with `MintFavicon` directly; URL input → `var(--surface-3)`/`var(--border)`
- Mint Detail mobile header — finally implemented (it was prepared in an earlier prompt round but never actually shipped by mistake): back arrow (30px circle) on the same row as avatar/name/URL, status dot instead of a separate "Online" pill, age badge on the right. Desktop layout unchanged (new elements hidden outside `@media (max-width: 768px)`)
- Mobile stat tiles (Latency/Uptime/Version/NUTs) — at ≤768px the large icon is hidden, padding narrowed, value 15px/600 on `--font-mono-data`

### Dashboard filter bugs (fixed)

- **Reset button (↻):** previously only did `queryClient.invalidateQueries` (refetched data) without resetting search/sort/filters/`showDegraded`. Fixed — now resets everything to default (search cleared, sort `name`/`asc`, `activeFilters`/`pendingFilters` → `DEFAULT_FILTERS`, `showDegraded=false`, closes filter panel) and only then refetches.
- **Status=Offline filter returning empty results:** root cause — `allMints` was computed by hiding degraded mints via `showDegraded` *before* `applyFilters()` ran, so Status=Offline and the default `showDegraded=false` behaved like an AND and cancelled each other out. Fix: `effectiveShowDegraded = showDegraded || activeFilters.status === 'offline'` — explicitly picking the Offline filter now overrides the default hiding. The "N mints hidden" message only shows when the Status filter isn't "Offline" (otherwise it would be misleading).
- File: `Dashboard.tsx`

Verified: typecheck ✅, build ✅, 70/70 unit tests ✅, Playwright confirmed both scenarios (Status=Offline shows offline mints including 24h+; Reset restores default state).

### Tools page layout — iterations and final state

Two desktop-layout attempts for the Tools page (`Tools.css`/`Tools.tsx`) were tried and reverted before landing on the final, minimal fix:
- **Attempt 1 (rejected):** `max-width: 420px` on individual elements (`.token-input`, `.tool-btn-primary`, a `.wizard-options-compact` modifier on the Small/Medium/Large option rows). Created dead space inside the panels on wide screens.
- **Attempt 2 (rejected):** `max-width` on the whole content grid via a centered container. Created empty margins on very wide monitors (32"+).
- **Final state:** layout reverted to full width everywhere — panels, the token textarea, and the Small/Medium/Large option rows are all 100% width again, matching the pre-iteration baseline. The only surviving change is the "Inspect Token" button: it got its own `inspect-token-btn` class (kept separate from the shared `.tool-btn-primary` specifically so the wizard's "Find my mints" button, which also uses `.tool-btn-primary`, is unaffected), with `max-width: 280px` and centered, desktop-only.
- Mobile layout was never touched across any of these iterations — confirmed correct throughout.
- Reference mockup `mintradar_redesign_mockup.html` still contains the "Tools desktop fix" and "Tools v2" tabs from the two rejected attempts — left in place deliberately as a record of what was tried and why it didn't work, not as current guidance.

## Nostr pool singleton

`src/core/nostr/pool.ts` exports `sharedPool` — a single `SimplePool` instance patched with exponential backoff (1s base, doubles per attempt, 5-min cap, ±20% jitter). All frontend Nostr reads/writes must use `sharedPool`. Never call `sharedPool.destroy()`.

## Backup cron

Runs every 6h: `0 */6 * * *` → `scripts/backup-db.sh`
- Output: `/var/backups/mintradar/mintradar_YYYYMMDD_HHMMSS.sql.gz` (rotates to 7 days)
- Log: `/var/log/mintradar-backup.log`
- Format: `pg_dump | gzip` — plain SQL, suitable for `zcat | psql` restore
- NOTE: `/var/backups/mintradar/` and `/var/log/mintradar-backup.log` must be owned by `deploy` user (created with `sudo`, `mkdir -p` in script cannot create them itself)

## Reviews Feature (Mint Detail)

All review-related relay lists now live in `src/core/nostr/relays.ts` (unified 2026-07-24):
- **REVIEW_RELAYS** (= DISCOVERY_RELAYS + `relay.minibits.cash`) — used by `src/hooks/useMintReviews.ts` to fetch kind:38000 events for a mint
- **REVIEW_PUBLISH_RELAYS** (= REVIEW_RELAYS + 7 extra relays: bitcoiner.social, nostr.mom, oxtr.dev, mostr.pub, noswhere.com, pyramid.fiatjaf.com, lopp.social) — a deliberately wider net used only by `src/hooks/useSubmitReview.ts` when publishing a new review, for propagation reach
- **PROFILE_RELAYS** (`relay.nostr.band, nos.lol, relay.primal.net, purplepag.es, relay.damus.io`) — unchanged, used for kind:0 profile lookups only

`backend/src/index.ts`'s `NOSTR_REVIEWS_RELAYS` (server-side review fetch endpoint) mirrors REVIEW_RELAYS manually — same no-workspace caveat as the discovery relays above.

Key implementation details:
- Rating parsed from `content` via regex `/\[(\d)\/5\]/` — the `rating` tag does not exist in practice
- Events without a rating AND without text body are discarded as meaningless
- Author Nostr profiles (name + avatar) are fetched inline inside `useMintReviews.ts` via **PROFILE_RELAYS** — a separate `useNostrProfiles` hook was removed due to a React state sync bug
- Security: `profile.picture` is rendered only if it starts with `https://`

## Mint Probe — Degraded/Offline Detection

**isSafeUrl** returns `'safe' | 'blocked' | 'dns-error'` — DNS failures are now written to `mint_history` as `online: false` instead of being silently skipped.

**Degraded logic** (in `backend/src/index.ts`):
```
degraded = (total24h >= 4 && onlineCount === 0) || isStaleOffline
isStaleOffline = last known state is offline AND older than 24h
```

Frontend hides degraded mints by default (`showDegraded=false`); footer shows "N mints hidden (offline 24h+) — Show".

**Known edge case:** After the first DNS-failure write, a mint may briefly show `degraded=false` for ~20 min until 4 probe records accumulate. Self-correcting, no intervention needed.

## Mobile Responsive Fixes (as of 2026-06-30)

- **Filter panel (Dashboard + Watchlist):** NUT SUPPORT — 7 chips per row via `grid-template-columns: repeat(7, 1fr)`; STATUS + MIN TRUST SCORE side by side (50/50) using `filter-group-row-top` wrapper with `display: contents` on desktop (transparent to flex layout) and `display: flex; flex-direction: row` at ≤768px
- **Stats page:** Sections stack vertically on mobile; NUT Coverage bars don't overflow (`overflow: hidden`, shorter progress bar max-width)
- **Mint Detail:** Public key truncated on mobile (first+last 8 chars), full hex on desktop

### White focus ring on chart tap (2026-08-07) — the element is the `<g>`, not the `<svg>`

**GOTCHA — two earlier fixes targeted the wrong element and shipped without effect.**

Tapping any Recharts chart on mobile painted a white, rounded rectangle around the
chart's plot area. Root cause: Recharts 3.x renders its internal z-index layers as
`<g tabindex="-1">` inside the chart `<svg>` (`recharts/zIndex/ZIndexPortal.js` —
`.recharts-zIndex-layer_100` for Area, `_400` for Line, and so on; the tooltip wrapper
in `component/TooltipBoundingBox.js` is the same). `tabindex="-1"` is not
keyboard-reachable, but Chrome **does** focus such an element when it is tapped, and
then paints its default two-tone focus ring (`outline: auto` — white outer ring, dark
`rgb(16,16,16)` inner ring, rounded corners) around that `<g>`'s box.

Why the earlier attempts missed it:
- `.recharts-surface:focus { outline: none }` — `.recharts-surface` is the `<svg>`. The
  innermost focusable element under the finger is the `<g>` inside it, so the `<svg>`
  only ever gets focus when the tap lands on the chart's blank outer margin.
- `-webkit-tap-highlight-color` — that controls the Android tap *flash*, a different
  mechanism entirely from a focus ring.

Fix (`src/index.css`): `.recharts-wrapper [tabindex="-1"]:focus{,-visible}` → `outline: none`.
Matching on the attribute rather than the generated class name survives recharts
renaming its layers. Zero a11y cost — `tabindex="-1"` can never be reached by keyboard,
and the keyboard ring on the `<svg>` (`tabIndex={0}`) is deliberately kept.

**Diagnostic method that found it** (use it again for any "mystery visual state on tap"):
`page.touchscreen.tap()` on an emulated mobile device, then walk the full ancestor chain
from `document.elementFromPoint(x,y)` to `<html>` and diff `getComputedStyle()` before vs.
immediately after the tap — never assume which element is involved. Automated assertions
alone were what let the two bad fixes pass; a clipped screenshot before/after at
production contrast is what actually proved the ring's position and shape.

Regression test: `e2e/chart-tap-focus.spec.ts` (Pixel 7 emulation). It asserts that *no*
element in the chain under the tap point has a non-`none` `outline-style`, so it stays
correct even if recharts moves the focus to a different node. Verified the test actually
fails without the CSS rule (not just that it passes with it) before landing.

**Verified on Chromium/Android only** (Playwright + Pixel 7 emulation). iOS Safari/WebKit
has NOT been verified — WebKit handles focus on `tabindex="-1"` differently from Chrome,
so if the white ring reappears on iOS this needs its own targeted diagnostic pass, not an
assumption that the same fix covers it.

## Tooltip positioning in scrollable/small containers

**Pattern:** in a small or scrollable container (e.g. the Network Health Index Breakdown
modal), a tooltip that always pops in one fixed direction (e.g. always upward) gets
clipped for rows near the edge that don't have room in that direction.

**Fix applied in `NetworkHealthModal` (`Stats.tsx`):** direction is chosen dynamically by
position in the list — the last 2 rows pop downward, the rest pop upward (rather than
one fixed direction for every row).

Same fix pattern as the existing precedent in `MintDetail.tsx:616` — when a similar
tooltip-clipping issue shows up in a small container elsewhere in the app, check this
pattern first before inventing a new one.

**Established visual rule:** info icons attached to a badge (e.g. "Backup supported", the
error badge) must be a separate sibling element placed next to the badge — never nested
inside the same pill-shaped container as the badge. This convention is used consistently
across the app.

## Testing Infrastructure

### Test counts (as of 2026-06-30): 275 total

| Suite | Count | Tool | Location |
|-------|-------|------|----------|
| Backend unit | 102 | Vitest | `backend/src/__tests__/` |
| Frontend unit | 70 | Vitest | `MintRadar/src/__tests__/` |
| API integration | 46 | Vitest | `backend/src/__tests__/integration/` |
| Security | 40 | Vitest | `backend/src/__tests__/security/` |
| E2E | 17 | Playwright | `MintRadar/e2e/` |

### Key tested modules

- **Backend:** `normalizeUrl`, Trust Score calculation (prober.ts), degraded/offline detection logic, review parsing (kind:38000 regex), SSRF guard (`backend/src/ssrf.ts`) — DNS rebinding, private ranges, link-local
- **Frontend:** `mintFormatting` and `reviewUtils` (extracted from components into `src/utils/` for testability), Trust Score display helpers. `mintFormatting.test.ts`'s `mintAgeBadge` Fresh/Established color assertions were updated 2026-07-24 to the new redesign hex values (`#d3a446`/`#5cc9a3`) — see "Visual Redesign" section.

### Run commands

```bash
# Backend (unit + integration + security)
cd backend && npm test

# Frontend unit
cd MintRadar && npm test

# E2E
cd MintRadar && npm run test:e2e
```

### E2E mocking strategy

- **HTTP:** `page.route('**/api/**', …)` with deterministic fixtures in `e2e/fixtures/mocks.ts`
- **Nostr relays (wss):** `page.routeWebSocket(/^wss:\/\//)` stub — replies `["EOSE", subId]` to every `REQ`, `["OK", id, true, ""]` to every `EVENT`. Required because `SimplePool.querySync()` hangs until EOSE; simply closing the socket is not sufficient.
- **NIP-07 login:** `page.addInitScript()` injects `window.nostr` mock (getPublicKey/signEvent/nip04/nip44) and pre-seeds Zustand persist key `mintradar_session` in `sessionStorage`

### Notable finding (not a bug)

The `+ Watch` button on Dashboard mint cards only renders when `isLoggedIn === true` (intentional — watchlist is identity-bound). E2E tests for the add-to-watchlist flow therefore require a mocked NIP-07 session.

### CI

`test` job in `.github/workflows/deploy.yml` runs all 275 tests. `deploy` job declares `needs: test` — a failing test blocks deployment.

## NUT tracking expansion (2026-07-02)

- Tracking 26 NUTs now (was 14) — added: 13, 16, 18, 21, 22, 23, 24, 25, 26, 27, 28, 30
- Mandatory NUTs (00-03, 06) are deliberately never tracked — implicitly 100% supported, zero information value
- Trust Score NUT divisor changed from /14 to /26 in `prober.ts` — existing mints get a lower/more accurate score at their next probe cycle
- NUT-24 (HTTP 402) has 0% adoption across the ecosystem — expected, no implementation exists yet anywhere

## Probe fixes — HTTP status handling

- HTTP 429 → probe cycle is skipped entirely (nothing written to `mint_history`); mint stays at its last known state instead of a false-positive offline
- HTTP 502/503/504 → one retry after 2s before recording offline (handles transient server-side blips like restarts/deploys)
- "Show my latency" (client-side test in MintDetail) fixed — previously used `mode: 'no-cors'` which hid the HTTP error status, so `fetch` resolved "successfully" even on a 502 and showed a fake latency. Now uses standard cors mode, reads `res.ok`/`res.status`, and shows `Unreachable (HTTP XXX)` instead of a bogus number
- Tooltip on the HTTP error badge (Mint Detail header) — maps 429/502/503/504 to an explanatory message for less technical users

## Mint Age Badge — known data limitation

- `mintAgeBadge()` in `src/utils/mintFormatting.ts` uses thresholds in **months**, not hours/days as previously assumed: `< 1 month` Fresh, `< 6` Established, `< 12` Veteran, `≥ 12` OG
- Input is `mints.discovered_at` — when MintRadar discovered/inserted the mint, NOT when the mint actually came into existence
- All 95 mints currently have `discovered_at` in the window 2026-06-17 to 2026-06-30 (from bulk seeding) → all show Fresh right now, none has reached even 1 month
- This is NOT a bug — it's expected behavior until the data naturally "ages." The badge will start differentiating mints automatically over the following months.

## Grok external review (2026-07-02)

- An external AI analysis of the project identified that not all official NUTs were tracked — led to the NUT tracking expansion above.
- Other recommendations were either already implemented, or knowingly rejected (see decisions below).
- Rejected: reserve audit verification (no standardized NUT for it), dark/light mode toggle, watchlist share link (conflicts with privacy-first design), historical NUT snapshots, comparison tool for more than 4 mints, search by operator pubkey (no data linkage exists), multi-region probe infrastructure.
- NUT security warning badge (NUT-09/11/12) — verified against live data: currently 0 of 55 online mints are missing these NUTs, so the badge would be dead code. Rejected.
- Multi-unit criterion in Best Mint Wizard — DEFERRED (not rejected). Units are currently never persisted to the DB (only transiently via `GET /api/mint/probe`, never written to `mints`). Implementing this requires: a new DB column, extending `prober.ts` to parse `/v1/keysets`, and adding the field to the `KnownMint` type and `/api/mints/known` response — deferred to a dedicated, larger session.

## ESLint zero-errors cleanup (2026-07-05)

The codebase is at **0 ESLint errors** (frontend + backend). Keep it that way — `eslint-plugin-react-hooks` v7 enforces compiler-grade rules (`purity`, `set-state-in-effect`, `refs`). Patterns established during the cleanup; reuse them instead of re-introducing effects:

- **`useNow()`** (`src/hooks/useNow.ts`) — ticking clock store via `useSyncExternalStore` (30 s interval, shared across subscribers). Use it for ANY "current time" read during render ("checked Xm ago", age thresholds, chart bucket alignment). Never call `Date.now()` in render/useMemo — the purity rule blocks it. Used by: ComparisonModal, MintDetail (chart slots), Tools (Token Inspector).
- **Keyed/derived state instead of setState-in-effect** — async results are stored keyed by the input they were produced for; `loading` is derived (`key !== currentInput`), never set synchronously in an effect. Applied in:
  - `useMintReviews` — reviews keyed by mint URL (also fixed a stale-data race when switching mints)
  - Dashboard submit form — `probe` keyed by `submitUrl`, `nostrLookup` keyed by trimmed input
  - Watchlist pagination — `extraVisible` keyed by `listKey` (sort + filtered list content); side effect: pagination no longer resets on every 60 s data refetch
- **AppShell login modal** — single `closeLoginModal()` callback resets all modal state and is wired into every close path (overlay, X, Cancel, Escape, successful login incl. QR flow). Do NOT re-add "close on profile change" / "reset on close" effects. In the QR success path `qrCancelRef` is nulled BEFORE close so the live BunkerSigner is not aborted.
- **`useWatchlistSync`** — `userWriteRelaysRef` is written in an effect (declared before Phase 1/2 effects, so it's current within the same commit); Phase 1 reads relays from the ref.
- **`pool.ts`** — `PatchableRelay` is a standalone type, NOT an intersection with `AbstractRelay` (its private `reconnectAttempts` collapses intersections to `never`). GOTCHA: `npm run typecheck` (`tsc --noEmit`) missed this; only `tsc -b` (used by `npm run build`) caught it — build is the authoritative type gate.

## Code splitting & bundle layout (2026-07-05)

- `/stats` and `/mint/:url` routes are `React.lazy` + `Suspense` in `App.tsx` — the only Recharts consumers. Initial load dropped ~1124 → ~671 kB raw (~130 kB gzip saved); `vendor-charts` (350 kB) loads on first chart-page visit.
- **GOTCHA — `manualChunks` is dead in Vite 8 (rolldown):** the compat layer silently ignores group changes (builds byte-identical output). Chunking lives in `rollupOptions.output.advancedChunks.groups` — first matching group wins, order matters.
- **`vendor-immer` group must stay:** immer is shared by the watchlist store (eager, via zustand middleware) and recharts (lazy, via @reduxjs/toolkit — a second nested copy exists). Without its own group it lands inside `vendor-charts` and drags the whole chart bundle back into the initial modulepreload set. If a new eager module ever shares a dep with recharts, give that dep its own group too — verify with: `grep vendor-charts dist/index.html` (must NOT appear in modulepreload).
- **GOTCHA — `vite.config.js` is a compiled artifact:** `tsc -b` emits it from `vite.config.ts` (tsconfig.node.json has no `noEmit`), and Vite resolves `.js` BEFORE `.ts`. Always edit `vite.config.ts`, then run `npm run build` to regenerate the `.js` — editing only the `.ts` without a build means Vite still uses the stale `.js`.

## Key rules
- **Before starting ANY new task, check `git branch --show-current`.** If it isn't `main`, find out why (an in-progress PR still awaiting merge vs. a forgotten checkout left over from a prior session) before committing anything. A 2026-08-05 session left a feature branch checked out after its PR had already merged; two unrelated follow-up fixes got committed there instead of on `main` and had to be recovered via a second PR (#54).
- NEVER modify anything not explicitly requested
- ALWAYS run typecheck before build
- ALWAYS rsync dist after build
- ALWAYS commit and push after deploy: `git push origin main && git push gitea main` (both remotes required)
- Conventional commits: feat:, fix:, refactor:, docs:, chore:
- Security: always audit new code for SSRF, rate limits, XSS
- Security: `verifyEvent()` from nostr-tools must be called on all inbound Nostr events (frontend hooks and backend discovery)
