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
- Auth: Nostr NIP-07 (nos2x-fox, Alby) + nsec manual entry (key zeroed after derivation) + NIP-46 bunker (implemented, nostr-tools/nip46 BunkerSigner)
- Fonts: DM Sans (self-hosted variable, weights 100–900), JetBrains Mono (self-hosted; Regular 400, Medium 500, Bold 700)
- CSS: CSS variables (var(--bg), var(--bg2), var(--accent) #17E87F, var(--border), var(--text), var(--text2), var(--text3))

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
- NUT Support 30%: min(nutCount/14, 1) * 30
- Version freshness 15%: based on Nutshell version recency
- Audit reliability 5%: based on error rate from audit_n_errors/(audit_n_mints+audit_n_melts+audit_n_errors)
- Stored in mints.last_trust_score after each probe

## Cron jobs
- Every 5min: probe all mints in DB → write to mint_history, update mints metadata + last_trust_score
- Every 6h: NIP-87 discovery from 7 relays + audit.8333.space API → INSERT new mints

## Discovery pipeline

`discoverMintsFromNostr()` in `backend/src/discovery.ts` runs 3 sources in parallel via `Promise.allSettled`:
- **kind:38172** — NIP-87 mint announcements (direct `u` tag)
- **kind:38000** — reviews; `#u` tag mining extracts reviewed mint URLs
- **audit.8333.space** — external audit API

Approximate yields (as of 2026-06-29): kind:38172 ~33 mints, kind:38000 ~37 mints, audit.8333.space ~61 mints. Total DB: ~97 mints.

**URL normalization:** `normalizeUrl()` lowercases the hostname before every INSERT. Applied in 4 places: `discoverMintsFromNostr`, `discoverMintsFromApi`, `POST /api/mint/submit`, `POST /api/mints/discover`. Prevents duplicates like `https://Mint.coinos.io` vs `https://mint.coinos.io` (the capital-M variant was a seed bug and was manually deleted).

## Discovery relays (backend + frontend)
wss://relay.damus.io, wss://nos.lol, wss://relay.primal.net,
wss://relay.cashumints.space, wss://relay.azzamo.net,
wss://purplepag.es, wss://relay.snort.social

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

## Nostr Login

Login modal (`src/components/layout/AppShell.tsx`) supports three methods selectable via radio cards:
- **NIP-07** — calls `window.nostr.getPublicKey()`; all signing stays in the extension
- **nsec** — decoded in `src/core/nostr/client.ts:loginWithNsec`; `privkeyBytes.fill(0)` called immediately after public key derivation; private key never assigned to module scope, never persisted
- **Amber / NIP-46 bunker** — fully implemented via `nostr-tools/nip46` `BunkerSigner`; accepts `bunker://` URI or NIP-05 identifier; QR pairing flow for mobile Amber; session persisted in `sessionStorage` (`bunkerURI`, `bunkerClientSecretKey`, `bunkerPubkey`); 30s connection timeout; client keypair is ephemeral (NOT the user's identity key)

`sessionStorage` (Zustand persist) stores only the public `NostrProfile` `{ pubkey, npub, name, picture }` — no private key material ever in storage.

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

### MintCard.tsx removed (dead code)

`src/components/mint/MintCard.tsx` and `src/components/mint/MintCard.css` were deleted. Both had zero imports anywhere in the codebase.

**CRITICAL for future prompts:** Dashboard and Watchlist do NOT share a common card component. Each has its own separate inline card renderer:
- `src/pages/Dashboard.tsx` → `MintCardDisplay` function (defined around line 208)
- `src/pages/Watchlist.tsx` → anonymous inline card renderer (no separate named component)

Any future task targeting "the mint card" or "the watch button" MUST specify which file to edit (Dashboard.tsx and/or Watchlist.tsx), or the same mistake of editing non-existent shared code will repeat.

### Security audit

Full report in `AUDIT.md` at the repo root. Covers: telemetry, key handling, dependencies, XSS, backend API, secrets, Docker, HTTP headers. Backend is at 0 npm vulnerabilities. Frontend has 6 remaining (all dev-server only; Vite v8 upgrade needed to fix).

## Dependency versions (as of 2026-06-29)

### Frontend
- eslint: 10.6.0 (upgraded from 9.x)
- eslint-plugin-react-hooks: 7.1.1 (upgraded from 5.2.0 — v7 adds ESLint v10 support)
- lucide-react: 1.22.0
- globals: 17.7.0
- @types/node: 26.0.1
- immer: 10.2.0 (intentionally held at v10 — PR #14 closed; v11 breaking changes unverified with Zustand)

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

## Dashboard Mint Count Distinction (deliberate product decision — 2026-06-20)

The Dashboard stat bar intentionally shows TWO different denominators that represent TWO different concepts:

- **"ONLINE MINTS X/Y" denominator** — "active" mints only (excludes mints that have been offline for 24h+, which are hidden from the grid by default behind a "N mints hidden (offline 24h+) — Show" toggle). Matches what's visible in the grid.
- **"KNOWN MINTS"** — absolute total mint count across the whole system (same source as Stats page "MINTS TRACKED", same as `rows.length` from `/api/stats`). Includes long-offline mints.

These are intentionally different numbers (e.g. "ONLINE MINTS 50/69" vs "KNOWN MINTS 88"). Do NOT "fix" this as an inconsistency in future sessions without re-confirming with the maintainer first.

The grid's default behavior of hiding 24h+ offline mints is intentional decluttering. The footer shows: "Showing X of Y — N mints hidden (offline 24h+) Show".

## Typography & Design System Notes

Self-hosted font weights:
- **DM Sans** — variable, weights 100–900; `--font-body`, `--font-display`, `--sans`
- **JetBrains Mono** — 400 Regular, 500 Medium, 700 Bold; `--font-mono`. Bold was added in `public/fonts/JetBrainsMono-Bold.woff2` + `@font-face` because weight 700 previously triggered faux bold.

**Stat box padding** — Desktop: Dashboard `.stat-card` and Stats `.stats-metric-card` both use `14px 20px`. MintDetail `.md-sc` uses `12px 16px` intentionally (tighter layout, product decision — do not "unify" without confirmation). Mobile: Dashboard reduces to `10px 14px` at `≤600px`; Stats reduces to `10px 14px` at `≤700px`.

**Mint Info value rows** (MintDetail) — all value `<span>` elements use `.md-info-value` class only, with no inline color/weight/family overrides. Inline `color: var(--text2)` previously made bold text look dim. Full description keeps `style={{textAlign:'left', maxWidth:'none', lineHeight:1.5}}` for layout only.

**Text colors** — `--text` (`#F0F2F7`) for primary/bold values, `--text2` (`#8B90A0`) for secondary/muted, `--text3`/`--t3` (`#AAB4C7`) for tertiary labels. `--text3` was changed from `#80899B` to `#AAB4C7` (brighter) in a previous session.

## Nostr pool singleton

`src/core/nostr/pool.ts` exports `sharedPool` — a single `SimplePool` instance patched with exponential backoff (1s base, doubles per attempt, 5-min cap, ±20% jitter). All frontend Nostr reads/writes must use `sharedPool`. Never call `sharedPool.destroy()`.

## Backup cron

Runs every 6h: `0 */6 * * *` → `scripts/backup-db.sh`
- Output: `/var/backups/mintradar/mintradar_YYYYMMDD_HHMMSS.sql.gz` (rotates to 7 days)
- Log: `/var/log/mintradar-backup.log`
- Format: `pg_dump | gzip` — plain SQL, suitable for `zcat | psql` restore
- NOTE: `/var/backups/mintradar/` and `/var/log/mintradar-backup.log` must be owned by `deploy` user (created with `sudo`, `mkdir -p` in script cannot create them itself)

## Reviews Feature (Mint Detail)

`src/hooks/useMintReviews.ts` fetches kind:38000 events from **REVIEW_RELAYS**:
`relay.damus.io, nos.lol, relay.cashumints.space, purplepag.es, relay.primal.net, relay.snort.social, offchain.pub, nostr-pub.wellorder.net, nostr.band, relay.minibits.cash`

Key implementation details:
- Rating parsed from `content` via regex `/\[(\d)\/5\]/` — the `rating` tag does not exist in practice
- Events without a rating AND without text body are discarded as meaningless
- Author Nostr profiles (name + avatar) are fetched inline inside `useMintReviews.ts` via **PROFILE_RELAYS** (`relay.nostr.band, nos.lol, relay.primal.net, purplepag.es, relay.damus.io`) — a separate `useNostrProfiles` hook was removed due to a React state sync bug
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
- **Frontend:** `mintFormatting` and `reviewUtils` (extracted from components into `src/utils/` for testability), Trust Score display helpers

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

## Key rules
- NEVER modify anything not explicitly requested
- ALWAYS run typecheck before build
- ALWAYS rsync dist after build
- ALWAYS commit and push after deploy: `git push origin main && git push gitea main` (both remotes required)
- Conventional commits: feat:, fix:, refactor:, docs:, chore:
- Security: always audit new code for SSRF, rate limits, XSS
- Security: `verifyEvent()` from nostr-tools must be called on all inbound Nostr events (frontend hooks and backend discovery)
