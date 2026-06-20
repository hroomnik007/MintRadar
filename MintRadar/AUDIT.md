# MintRadar — Security & Privacy Audit

**Date:** 2026-06-20  
**Auditor:** Automated review via Claude Code  
**Scope:** Full codebase — frontend (`src/`), backend (`backend/src/`), Docker, nginx config, dependencies

---

## 1. Tracking / Telemetry / Analytics

**What was checked:** All `.ts`/`.tsx` files for known analytics libraries (Google Analytics, Plausible, Mixpanel, Sentry, PostHog, Amplitude, Segment, Hotjar, FullStory, Heap, Datadog); `<script>` tags in `index.html`; `fetch`/`axios` calls to analytics endpoints; cookie usage; service worker behaviour.

**Findings:**
- No analytics or telemetry libraries found anywhere in the codebase.
- No third-party `<script>` tags in `index.html`.
- No cookies set (frontend or backend).
- Service worker (vite-plugin-pwa / Workbox): `/api/*` routes are `NetworkOnly` — not cached; no telemetry hooks in workbox config.
- **Issue found and fixed:** `index.html` contained three Google Fonts links (`preconnect` to `fonts.googleapis.com` / `fonts.gstatic.com` and a `<link rel=stylesheet>` fetching Inter + JetBrains Mono). These caused a network request to Google on every page load, leaking the user's IP address and visit. The fonts are **fully self-hosted** in `public/fonts/` and loaded via `@font-face` in `src/index.css` — the Google Fonts links were redundant. **Removed.**

**Fixed in:** `index.html`

**Status: CLEAN** (after fix)

---

## 2. Nostr Private Key Handling (nsec)

**What was checked:** All auth-related files — `src/stores/auth.store.ts`, `src/core/nostr/client.ts`, `src/core/crypto/vault.ts`, `src/core/nostr/watchlistSync.ts`, `src/hooks/useSubmitReview.ts`, `src/hooks/useWatchlistNotifications.ts`.

**Findings:**

**NIP-07 (browser extension) login path:**
- `loginWithNip07()` calls `window.nostr.getPublicKey()` — the extension returns only the public key; the app never has access to the raw private key.
- All signing (`signEvent`, `nip44.encrypt`, `nip44.decrypt`) goes through `window.nostr.*` — the private key never leaves the extension.

**nsec (manual) login path:**
- `loginWithNsec(input)` decodes the nsec, derives the public key, then constructs a `NostrProfile` containing only `{ pubkey, npub, name, picture }`.
- The `privkeyBytes` variable is local to that function and goes out of scope immediately after the call — it is **never assigned to any module-level variable, stored in localStorage, sessionStorage, IndexedDB, or sent to the backend**.
- The `NostrProfile` object (public data only) is persisted to `sessionStorage` via Zustand persist middleware — **no private key in sessionStorage**.
- Logout clears the session: `set({ profile: null })`.

**`vault.ts` — dead code note:**
- `src/core/crypto/vault.ts` contains module-scope private key storage (`_privkey`) and NIP-44 encryption helpers. This file is **not imported by any active code path** in the current build. Its `importPrivkey()` function also has a broken nsec bech32 decode (`nsec1` is stripped via `.slice(5)` rather than proper bech32 decode). Since it is unused it poses no runtime risk, but it should be removed or properly implemented in a future cleanup.

**No private key logging:** Confirmed no `console.log`, error handler, or network request includes private key material.

**Minor recommendation:** The `privkeyBytes` buffer in `loginWithNsec` is not explicitly zeroed (`privkeyBytes.fill(0)`) before it goes out of scope. JavaScript GC does not guarantee immediate collection. For a high-security implementation, explicitly zeroing the buffer before the function returns would reduce the window where key material exists in memory.

**Status: CLEAN**

---

## 3. Dependency Vulnerabilities

### Frontend (`/`)

| Severity | Count (before) | Count (after fix) |
|----------|---------------|-------------------|
| Critical | 1             | 1                 |
| High     | 1             | 1                 |
| Moderate | 5             | 4                 |
| Low      | 1             | 0                 |
| **Total**| **8**         | **6**             |

**Fixed** (`npm audit fix`, non-breaking): 2 vulnerabilities removed — `@babel/core` Arbitrary File Read (GHSA-4x5r-pxfx-6jf8) and `js-yaml` DoS (GHSA-h67p-54hq-rp68).

**Remaining (6) — manual review needed:**

Root cause: `esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99) — allows any website to make cross-origin requests to the running **development server**. Fix requires `npm audit fix --force` which upgrades Vite from v5 → v8 (breaking change).

Affected packages (all transitive, same root): `vite`, `vite-plugin-pwa`, `vite-node`, `@vitest/mocker`, `vitest`.

**Production risk: LOW.** This vulnerability only affects the local dev server (`vite dev`). Production builds do not run esbuild's development server. The production deployment (static files served by nginx) is not affected.

**Recommendation:** Schedule a Vite v8 upgrade and test thoroughly before applying `npm audit fix --force`.

### Backend (`/backend`)

| Severity | Count (before) | Count (after fix) |
|----------|---------------|-------------------|
| High     | 1             | 0                 |
| Low      | 1             | 0                 |
| **Total**| **2**         | **0**             |

**Fixed** (`npm audit fix`): `undici <=6.26.0` (HTTP header injection, WebSocket DoS, response queue poisoning — GHSA-p88m-4jfj-68fv, GHSA-vxpw-j846-p89q, GHSA-35p6-xmwp-9g52, GHSA-g8m3-5g58-fq7m) and `esbuild` Windows file-read (GHSA-g7r4-m6w7-qqqr).

**Status: BACKEND CLEAN. Frontend needs Vite v8 upgrade (non-urgent, dev-only CVE).**

---

## 4. XSS / Injection Prevention

**What was checked:** `dangerouslySetInnerHTML` usage; `href` attributes built from mint-provided data; rendering of untrusted mint fields (name, description, MOTD, contact info, NUT data).

**Findings:**
- **No `dangerouslySetInnerHTML` found anywhere in the codebase.** All mint-provided text is rendered as React children (auto-escaped).
- **`tosUrl` href (`MintDetail.tsx:667`):** Guarded by an explicit check before rendering: `tosUrl.startsWith('https://') || tosUrl.startsWith('http://')`. `javascript:` URIs cannot pass this check. ✅
- **Wallet link (`MintDetail.tsx:1230`):** `href={`https://wallet.cashu.me/?mint=${encodeURIComponent(url)}`}` — mint URL is `encodeURIComponent`-escaped. ✅
- **NUT spec link (`MintDetail.tsx:1538`, `NutExplorer.tsx:70–80`):** Template `https://github.com/cashubtc/nuts/blob/main/${...}.md` — the path segment is derived from `parseInt(...)` on a known NUT label, producing only a number string. ✅
- **Contact info (email, twitter, nostr):** Rendered as plain text with clipboard copy buttons — no `<a href>` tags with user-controlled values. ✅
- **Mint name, description, MOTD, NUT descriptions:** All rendered as React text nodes. ✅

**Status: CLEAN**

---

## 5. Backend API Security

**What was checked:** CORS configuration, rate limiting, SQL query patterns, input validation on all endpoints.

**CORS:**
- Production origin: `https://mintradar.pedani.eu` only (hardcoded default, no wildcard).
- Configurable via `ALLOWED_ORIGINS` env var.
- Dev default: adds `http://localhost:5173`.
- `null` origin (e.g. file:// or no-origin) is allowed — this is intentional for health check accessibility and low-risk since no auth cookies exist. ✅

**Rate limiting:**
- General: 60 requests / IP / minute on all non-exempt endpoints.
- Submit (`POST /api/mint/submit`): 20 / IP / hour — each submit triggers 2+ outbound probes.
- Discover (`POST /api/mints/discover`): 10 / IP / hour — each accepts up to 100 URLs.
- In-memory stores cleaned up with `setInterval` to prevent unbounded growth. ✅
- Rate limit stores are in-process only — reset on restart. Recommendation: if the service scales to multiple processes, use Redis-backed rate limiting.

**SQL queries:**
- All database queries use the `pg` pool's parameterized query interface (`pool.query(sql, [param])`). No raw string interpolation of user input into SQL found. ✅

**Input validation:**
- All URL-accepting endpoints validate: `typeof url === 'string'`, `url.startsWith('https://')`, `url.length <= 500`, and `isSafeUrl(url)` (async SSRF check).
- `POST /api/mint/submit`: validates online status (must return valid `/v1/info` with `nuts` field).
- `POST /api/mints/discover`: validates each URL in the batch individually; skips non-strings and unsafe URLs.

**SSRF protection (`backend/src/ssrf.ts`):**
- Blocks loopback, private, link-local, unique-local, unspecified, reserved, CGN, and broadcast ranges.
- Handles IPv4-mapped IPv6 addresses (`::ffff:x.x.x.x`).
- DNS pinning via custom `lookup` function passed to undici `Agent` — re-validates resolved IPs at connect time, closing the TOCTOU DNS-rebinding window. ✅
- Redirects followed manually (max 3 hops), each hop re-validated with `isSafeUrl()`. ✅

**Security headers (backend):**
- `X-Content-Type-Options: nosniff` ✅
- `X-Frame-Options: DENY` ✅
- `Referrer-Policy: no-referrer` ✅
- `X-XSS-Protection: 0` (disables legacy IE XSS filter, correct modern practice) ✅
- No `Content-Security-Policy` on backend — not critical since the backend serves only JSON and is behind nginx which sets CSP on the frontend. Acceptable.

**Status: CLEAN**

---

## 6. Secrets Management

**What was checked:** Hardcoded credentials in committed source; `.env` files in `.gitignore`; `.env.example` content.

**Findings:**
- No hardcoded passwords, API keys, private keys, or AWS-style credentials found in any committed source file.
- `.gitignore` correctly excludes `.env`, `.env.local`, `.env.*.local`, and `CLAUDE.local.md`.
- `backend/.env.example` contains only placeholder values (`user:password@localhost`, `mintradar`). No real secrets. ✅
- `.env` files are not tracked by git (verified with `git ls-files`). ✅

**Status: CLEAN**

---

## 7. Docker / Deployment Security

**What was checked:** `backend/Dockerfile`, `docker-compose.yml`.

**Dockerfile:**
- Base image: `node:20-alpine` (minimal attack surface). ✅
- Final stage runs as `USER node` — not root. ✅
- Only `dist/` is copied (compiled output, not source).

**docker-compose.yml:**
- Backend port bound to `127.0.0.1:3002:3002` — not reachable from the public internet; nginx proxies inbound traffic. ✅
- PostgreSQL: no external port mapping — accessible only within the `mintradar_net` bridge network. ✅
- Secrets passed via `env_file` and `environment` referencing `${POSTGRES_PASSWORD}` from the host environment — not hardcoded. ✅

**Status: CLEAN**

---

## 8. HTTP Security Headers

**What was checked:** `deploy/nginx.conf` and backend middleware.

**Issue found and fixed:** `deploy/nginx.conf` had `server_name privyzap.pedani.eu` (wrong project domain), pointing to incorrect SSL certificate paths and a non-existent `root` directory (`/var/www/privyzap`). The file was also missing the `/api/` reverse proxy block to the backend. **Updated to `mintradar.pedani.eu` with correct paths and proxy config.**

**Headers now present in `deploy/nginx.conf`:**

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https:; connect-src 'self' wss: ws:; worker-src 'self'; frame-ancestors 'none';` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

**CSP notes:**
- `script-src 'self'` — no `'unsafe-eval'`, no CDN scripts. ✅
- `font-src 'self'` — consistent with self-hosted fonts (Google Fonts removed). ✅
- `img-src ... https:` — required for mint favicons fetched from external mint servers. ✅
- `connect-src 'self' wss: ws:` — covers Nostr relay WebSocket connections. ✅
- `frame-ancestors 'none'` — equivalent to `X-Frame-Options: DENY`, belt-and-suspenders. ✅

**Fixed in:** `deploy/nginx.conf`

**Important:** The nginx.conf in the repo reflects the intended production configuration. After deploying, verify the live headers with: `curl -I https://mintradar.pedani.eu`

**Status: CLEAN** (after fix; pending re-deploy)

---

## Summary of Changes Made

| File | Change |
|------|--------|
| `index.html` | Removed Google Fonts `<link>` tags (3 lines) — privacy fix |
| `deploy/nginx.conf` | Corrected domain, SSL paths, root path, added `/api/` proxy block, added `Strict-Transport-Security` header |
| `package-lock.json` (frontend) | `npm audit fix` — patched `@babel/core` and `js-yaml` |
| `backend/package-lock.json` | `npm audit fix` — patched `undici` and `esbuild` (backend now 0 vulnerabilities) |

## Open Recommendations (No Code Change Made)

1. **Vite v8 upgrade** — resolve remaining 6 frontend vulnerabilities (all dev-server only, low production risk). Test PWA plugin, routing, and build output after upgrading.
2. **vault.ts cleanup** — `src/core/crypto/vault.ts` is dead code. Either remove it or properly wire it up (fix the broken bech32 decode in `importPrivkey`).
3. **privkeyBytes zeroing** — In `src/core/nostr/client.ts` `loginWithNsec()`, explicitly `privkeyBytes.fill(0)` before the function returns to minimize the window where key material exists in memory.
4. **Redis-backed rate limiting** — Current in-process rate limit stores reset on restart and don't share state across processes. If the backend ever scales horizontally, migrate to Redis.
5. **nginx.conf re-deploy** — After the next nginx config update on the VPS, verify headers with `curl -I https://mintradar.pedani.eu` and confirm `Strict-Transport-Security` is present.
